import { migrationsApplied, DATABASE_PATH } from './db';
import { seedSettings } from './settings';
import { ensureBootstrapAdmin, purgeExpired } from './auth';
import { startCron } from './cron';
import { mailConfigured } from './mail';
import { logger } from './logger';

let booted = false;

/** Amorcage du process : migrations, reglages, admin initial, ordonnanceur. */
export function boot(): void {
	if (booted) return;
	booted = true;

	logger.info(`Base SQLite : ${DATABASE_PATH} (${migrationsApplied} migration(s) appliquee(s))`);
	seedSettings();
	ensureBootstrapAdmin();
	purgeExpired();

	if (!mailConfigured()) {
		logger.warn('SMTP non configure : les magic links seront ecrits dans les logs du conteneur.');
	}

	startCron();
	logger.info('Application prete.');
}
