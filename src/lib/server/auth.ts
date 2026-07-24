import { createHmac, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull, lt } from 'drizzle-orm';
import { db } from './db';
import { invites, loginTokens, sessions, users } from './db/schema';
import { now } from '$lib/time';
import { logger } from './logger';
import type { User } from './db/schema';

export const SESSION_COOKIE = 'pronos_session';
const SESSION_TTL = 60 * 24 * 3600; // 60 jours
const LOGIN_TOKEN_TTL = 30 * 60; // 30 minutes

function secret(): string {
	const value = process.env.AUTH_SECRET ?? '';
	if (value.length >= 32) return value;
	if (process.env.NODE_ENV === 'production') {
		throw new Error('AUTH_SECRET doit contenir au moins 32 caracteres en production');
	}
	return 'dev-secret-non-securise-a-remplacer-en-production';
}

/** Les jetons ne sont jamais stockes en clair : la base ne garde que le HMAC. */
export function hashToken(token: string): string {
	return createHmac('sha256', secret()).update(token).digest('hex');
}

export function newToken(): string {
	return randomBytes(32).toString('base64url');
}

export function generateInviteCode(): string {
	// Alphabet sans caracteres ambigus (0/O, 1/I) : le code se dicte au telephone.
	const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
	const raw = randomBytes(12);
	let out = '';
	for (let i = 0; i < 12; i++) {
		if (i > 0 && i % 4 === 0) out += '-';
		out += alphabet[raw[i] % alphabet.length];
	}
	return out;
}

export function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export function createSession(userId: number, userAgent?: string | null): string {
	const token = newToken();
	const ts = now();
	db.insert(sessions)
		.values({
			id: hashToken(token),
			userId,
			userAgent: userAgent?.slice(0, 255) ?? null,
			createdAt: ts,
			expiresAt: ts + SESSION_TTL
		})
		.run();
	return token;
}

export function resolveSession(token: string | undefined): User | null {
	if (!token) return null;
	const row = db
		.select({ session: sessions, user: users })
		.from(sessions)
		.innerJoin(users, eq(users.id, sessions.userId))
		.where(and(eq(sessions.id, hashToken(token)), gt(sessions.expiresAt, now())))
		.get();
	if (!row) return null;
	if (row.user.active !== 1) return null;
	return row.user;
}

export function destroySession(token: string | undefined): void {
	if (!token) return;
	db.delete(sessions).where(eq(sessions.id, hashToken(token))).run();
}

export function purgeExpired(): void {
	const ts = now();
	db.delete(sessions).where(lt(sessions.expiresAt, ts)).run();
	db.delete(loginTokens).where(lt(loginTokens.expiresAt, ts)).run();
}

// ---------------------------------------------------------------------------
// Magic links
// ---------------------------------------------------------------------------

export function createLoginToken(userId: number): string {
	const token = newToken();
	const ts = now();
	db.insert(loginTokens)
		.values({
			id: hashToken(token),
			userId,
			createdAt: ts,
			expiresAt: ts + LOGIN_TOKEN_TTL
		})
		.run();
	return token;
}

/** Consomme un jeton de magic link. Usage unique, verifie l'expiration. */
export function consumeLoginToken(token: string): User | null {
	const id = hashToken(token);
	const row = db
		.select({ token: loginTokens, user: users })
		.from(loginTokens)
		.innerJoin(users, eq(users.id, loginTokens.userId))
		.where(and(eq(loginTokens.id, id), isNull(loginTokens.usedAt), gt(loginTokens.expiresAt, now())))
		.get();
	if (!row) return null;
	if (row.user.active !== 1) return null;

	db.update(loginTokens).set({ usedAt: now() }).where(eq(loginTokens.id, id)).run();
	return row.user;
}

export function magicLinkUrl(token: string, origin: string): string {
	const base = (process.env.PUBLIC_BASE_URL ?? origin).replace(/\/$/, '');
	return `${base}/connexion/verifier?token=${encodeURIComponent(token)}`;
}

// ---------------------------------------------------------------------------
// Utilisateurs et invitations
// ---------------------------------------------------------------------------

export function findUserByEmail(email: string): User | undefined {
	return db.select().from(users).where(eq(users.email, normalizeEmail(email))).get();
}

export function findUserById(id: number): User | undefined {
	return db.select().from(users).where(eq(users.id, id)).get();
}

export interface RedeemResult {
	ok: boolean;
	error?: string;
	user?: User;
}

/**
 * Echange un code d'invitation contre un compte. Le code est a usage unique et
 * peut etre nominatif (rattache a une adresse email precise).
 */
export function redeemInvite(code: string, email: string, pseudo: string): RedeemResult {
	const cleanCode = code.trim().toUpperCase();
	const cleanEmail = normalizeEmail(email);
	const cleanPseudo = pseudo.trim();

	if (!cleanCode) return { ok: false, error: "Code d'invitation manquant." };
	if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) {
		return { ok: false, error: 'Adresse email invalide.' };
	}
	if (cleanPseudo.length < 2 || cleanPseudo.length > 24) {
		return { ok: false, error: 'Le pseudo doit faire entre 2 et 24 caracteres.' };
	}

	const invite = db.select().from(invites).where(eq(invites.code, cleanCode)).get();
	if (!invite) return { ok: false, error: "Code d'invitation inconnu." };
	if (invite.usedBy) return { ok: false, error: "Ce code d'invitation a deja ete utilise." };
	if (invite.expiresAt && invite.expiresAt < now()) {
		return { ok: false, error: "Ce code d'invitation a expire." };
	}
	if (invite.email && normalizeEmail(invite.email) !== cleanEmail) {
		return { ok: false, error: "Ce code est reserve a une autre adresse email." };
	}

	if (findUserByEmail(cleanEmail)) {
		return { ok: false, error: 'Un compte existe deja pour cette adresse email.' };
	}
	const pseudoTaken = db.select().from(users).where(eq(users.pseudo, cleanPseudo)).get();
	if (pseudoTaken) return { ok: false, error: 'Ce pseudo est deja pris.' };

	const ts = now();
	let created: User | undefined;

	db.transaction(() => {
		db.insert(users)
			.values({ pseudo: cleanPseudo, email: cleanEmail, role: 'joueur', createdAt: ts })
			.run();
		created = findUserByEmail(cleanEmail);
		if (!created) throw new Error('Creation du compte impossible');
		db.update(invites)
			.set({ usedBy: created.id, usedAt: ts })
			.where(eq(invites.id, invite.id))
			.run();
	});

	return { ok: true, user: created };
}

export function createInvite(options: {
	email?: string | null;
	note?: string | null;
	ttlDays?: number;
	createdBy?: number | null;
}) {
	const ts = now();
	const code = generateInviteCode();
	db.insert(invites)
		.values({
			code,
			email: options.email ? normalizeEmail(options.email) : null,
			note: options.note ?? null,
			expiresAt: options.ttlDays ? ts + options.ttlDays * 86400 : null,
			createdBy: options.createdBy ?? null,
			createdAt: ts
		})
		.run();
	return db.select().from(invites).where(eq(invites.code, code)).get()!;
}

/**
 * Cree le compte administrateur au premier demarrage si ADMIN_EMAIL est defini.
 * Sans cela, personne ne pourrait emettre la premiere invitation.
 */
export function ensureBootstrapAdmin(): void {
	const email = process.env.ADMIN_EMAIL ? normalizeEmail(process.env.ADMIN_EMAIL) : '';
	if (!email) return;

	const existing = findUserByEmail(email);
	if (existing) {
		if (existing.role !== 'admin') {
			db.update(users).set({ role: 'admin' }).where(eq(users.id, existing.id)).run();
			logger.info(`Compte ${email} promu administrateur`);
		}
		return;
	}

	const pseudo = (process.env.ADMIN_PSEUDO ?? 'admin').trim() || 'admin';
	db.insert(users)
		.values({ pseudo, email, role: 'admin', createdAt: now() })
		.onConflictDoNothing()
		.run();
	logger.info(`Compte administrateur cree pour ${email}`);
}
