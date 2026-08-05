import { db } from './db';
import { settings } from './db/schema';
import { now } from '$lib/time';
import { ECARTS } from '$lib/scoring';

/**
 * Toutes les constantes du bareme vivent en base et sont modifiables par
 * l'admin avant le debut de saison (spec 2.5).
 */
export const SETTING_DEFS = {
	'scoring.k': {
		value: 25,
		label: 'Numerateur du bareme (points = K / p)',
		group: 'Bareme',
		min: 1,
		max: 500,
		step: 1
	},
	'scoring.base_min': {
		value: 25,
		label: 'Plancher des points de base',
		group: 'Bareme',
		min: 0,
		max: 500,
		step: 1
	},
	'scoring.base_max': {
		value: 250,
		label: 'Plafond des points de base',
		group: 'Bareme',
		min: 1,
		max: 2000,
		step: 1
	},
	'scoring.margin_bonus_pct': {
		value: 0.5,
		label: "Bonus ecart exact (fraction des points de base)",
		group: 'Bareme',
		min: 0,
		max: 5,
		step: 0.05
	},
	'bonus.k': {
		value: ECARTS.k,
		label: 'Numerateur du bonus de rarete (bonus = k / f(ecart))',
		group: 'Bonus de rarete',
		min: 0.001,
		max: 1,
		step: 0.000001
	},
	'bonus.plancher': {
		value: ECARTS.plancher,
		label: 'Bonus minimal, meme sur l’ecart le plus banal',
		group: 'Bonus de rarete',
		min: 0,
		max: 5,
		step: 0.05
	},
	'bonus.plafond': {
		value: ECARTS.plafond,
		label: 'Bonus maximal, meme sur l’ecart le plus rare',
		group: 'Bonus de rarete',
		min: 0,
		max: 10,
		step: 0.05
	},
	'bonus.pas': {
		value: 0.25,
		label: 'Bonus perdu par point d’erreur sur l’ecart',
		group: 'Bonus de rarete',
		min: 0,
		max: 1,
		step: 0.05
	},
	'scoring.exact_bonus_pct': {
		value: 1,
		label: 'Bonus score exact (fraction des points de base)',
		group: 'Bareme',
		min: 0,
		max: 5,
		step: 0.05
	},
	'scoring.draw_factor': {
		value: 0.5,
		label: 'Part des points de base en cas de match nul',
		group: 'Bareme',
		min: 0,
		max: 1,
		step: 0.05
	},
	'scoring.fallback_p': {
		value: 0.5,
		label: 'Probabilite de repli si cotes indisponibles',
		group: 'Bareme',
		min: 0.01,
		max: 0.99,
		step: 0.01
	},
	'playoffs.enabled': {
		value: 0,
		label: 'Activer les multiplicateurs de playoffs',
		group: 'Playoffs',
		min: 0,
		max: 1,
		step: 1
	},
	'playoffs.mult.1': {
		value: 1.5,
		label: 'Multiplicateur Wild Card',
		group: 'Playoffs',
		min: 1,
		max: 10,
		step: 0.1
	},
	'playoffs.mult.2': {
		value: 2,
		label: 'Multiplicateur Divisional',
		group: 'Playoffs',
		min: 1,
		max: 10,
		step: 0.1
	},
	'playoffs.mult.3': {
		value: 2.5,
		label: 'Multiplicateur Championships',
		group: 'Playoffs',
		min: 1,
		max: 10,
		step: 0.1
	},
	'playoffs.mult.5': {
		value: 3,
		label: 'Multiplicateur Super Bowl',
		group: 'Playoffs',
		min: 1,
		max: 10,
		step: 0.1
	},
	'season.year': {
		value: Number(process.env.SEASON_YEAR ?? 2026),
		label: 'Saison en cours',
		group: 'Saison',
		min: 2020,
		max: 2100,
		step: 1
	},
	'mail.reminder_enabled': {
		value: 0,
		label: 'Email de rappel du jeudi matin',
		group: 'Options',
		min: 0,
		max: 1,
		step: 1
	}
} as const;

export type SettingKey = keyof typeof SETTING_DEFS;

let cache: Map<string, number> | null = null;

function load(): Map<string, number> {
	if (cache) return cache;
	const rows = db.select().from(settings).all();
	const map = new Map<string, number>();
	for (const key of Object.keys(SETTING_DEFS) as SettingKey[]) {
		map.set(key, SETTING_DEFS[key].value);
	}
	for (const row of rows) {
		const n = Number(row.value);
		if (Number.isFinite(n)) map.set(row.key, n);
	}
	cache = map;
	return map;
}

export function invalidateSettings(): void {
	cache = null;
}

export function getSetting(key: SettingKey): number {
	return load().get(key) ?? SETTING_DEFS[key].value;
}

export function setSetting(key: SettingKey, value: number): void {
	const def = SETTING_DEFS[key];
	if (!def) throw new Error(`Reglage inconnu : ${key}`);
	if (!Number.isFinite(value)) throw new Error(`Valeur invalide pour ${key}`);
	const clamped = Math.min(def.max, Math.max(def.min, value));
	db.insert(settings)
		.values({ key, value: String(clamped), updatedAt: now() })
		.onConflictDoUpdate({
			target: settings.key,
			set: { value: String(clamped), updatedAt: now() }
		})
		.run();
	invalidateSettings();
}

/** Le bareme complet, tel qu'utilise par le moteur de calcul. */
export function getScoringConfig() {
	return {
		k: getSetting('scoring.k'),
		baseMin: getSetting('scoring.base_min'),
		baseMax: getSetting('scoring.base_max'),
		marginBonusPct: getSetting('scoring.margin_bonus_pct'),
		bonusK: getSetting('bonus.k'),
		bonusPlancher: getSetting('bonus.plancher'),
		bonusPlafond: getSetting('bonus.plafond'),
		bonusPas: getSetting('bonus.pas'),
		exactBonusPct: getSetting('scoring.exact_bonus_pct'),
		drawFactor: getSetting('scoring.draw_factor'),
		fallbackP: getSetting('scoring.fallback_p'),
		playoffsEnabled: getSetting('playoffs.enabled') === 1,
		playoffMultipliers: {
			1: getSetting('playoffs.mult.1'),
			2: getSetting('playoffs.mult.2'),
			3: getSetting('playoffs.mult.3'),
			// Semaine 4 = Pro Bowl cote ESPN : pas de multiplicateur dedie.
			4: 1,
			5: getSetting('playoffs.mult.5')
		} as Record<number, number>
	};
}

export type ScoringConfig = ReturnType<typeof getScoringConfig>;

export function currentSeason(): number {
	return getSetting('season.year');
}

// ---------------------------------------------------------------------------
// Reglages textuels
// ---------------------------------------------------------------------------

/**
 * `SETTING_DEFS` ne decrit que des nombres — bornes, pas, curseurs de l'admin.
 * Le nom de la ligue n'entre pas dans ce moule. Il vit dans la meme table
 * `settings` (dont la colonne `value` est deja du texte, donc aucun changement
 * de schema), avec son propre acces et son propre cache.
 */
export const TEXT_SETTING_DEFS = {
	'league.name': { value: 'Pronos NFL', label: 'Nom de la ligue', max: 40 }
} as const;

export type TextSettingKey = keyof typeof TEXT_SETTING_DEFS;

let textCache: Map<string, string> | null = null;

export function invalidateTextSettings(): void {
	textCache = null;
}

export function getTextSetting(key: TextSettingKey): string {
	if (!textCache) {
		const map = new Map<string, string>();
		for (const k of Object.keys(TEXT_SETTING_DEFS) as TextSettingKey[]) {
			map.set(k, TEXT_SETTING_DEFS[k].value);
		}
		for (const row of db.select().from(settings).all()) {
			if (estReglageTexte(row.key) && row.value.trim() !== '') map.set(row.key, row.value);
		}
		textCache = map;
	}
	return textCache.get(key) ?? TEXT_SETTING_DEFS[key].value;
}

function estReglageTexte(key: string): key is TextSettingKey {
	return Object.prototype.hasOwnProperty.call(TEXT_SETTING_DEFS, key);
}

export function setTextSetting(key: TextSettingKey, value: string): void {
	const def = TEXT_SETTING_DEFS[key];
	if (!def) throw new Error(`Reglage inconnu : ${key}`);
	// Vide = retour au defaut plutot qu'une ligue sans nom dans l'entete.
	const propre = value.trim().slice(0, def.max) || def.value;
	db.insert(settings)
		.values({ key, value: propre, updatedAt: now() })
		.onConflictDoUpdate({ target: settings.key, set: { value: propre, updatedAt: now() } })
		.run();
	invalidateTextSettings();
}

export function leagueName(): string {
	return getTextSetting('league.name');
}

export function listSettings() {
	const values = load();
	return (Object.keys(SETTING_DEFS) as SettingKey[]).map((key) => ({
		key,
		...SETTING_DEFS[key],
		current: values.get(key) ?? SETTING_DEFS[key].value
	}));
}

/** Les reglages du bareme sont geles des qu'un match a ete score. */
export function seedSettings(): void {
	const existing = db.select().from(settings).all();
	if (existing.length > 0) return;
	const ts = now();
	const rows = (Object.keys(SETTING_DEFS) as SettingKey[]).map((key) => ({
		key,
		value: String(SETTING_DEFS[key].value),
		updatedAt: ts
	}));
	db.insert(settings).values(rows).onConflictDoNothing().run();
	invalidateSettings();
}
