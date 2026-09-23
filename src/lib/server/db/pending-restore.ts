import { existsSync, renameSync, rmSync } from 'node:fs';

/**
 * Restauration differee : le remplacement est depose a cote de la base, et
 * c'est le demarrage suivant qui le met en place.
 *
 * Pourquoi ne pas remplacer la base directement depuis la requete admin : la
 * connexion SQLite est un singleton ouvert a l'import de `db/index.ts` et
 * partage par tout le serveur. La fermer au milieu d'une requete casse le
 * rechargement de la page qui suit l'action, la session lue par les hooks, et
 * tout ce que le cron ferait au meme instant.
 *
 * Ici, le remplacement se fait **avant** que la moindre connexion soit
 * ouverte : plus aucun descripteur ne tient la base, et il n'existe pas
 * d'instant ou du code tourne sur une base a moitie remplacee.
 */

export function pendingRestorePath(databasePath: string): string {
	return `${databasePath}.restaurer`;
}

/**
 * Met en place un remplacement en attente, s'il y en a un. Renvoie `true` si
 * une restauration a effectivement eu lieu.
 *
 * Supprimer `-wal` et `-shm` n'est pas optionnel : laisses en place, SQLite
 * rejouerait par-dessus la base restauree un journal qui ne lui correspond
 * plus. C'est le piege classique de la restauration en mode WAL.
 */
export function applyPendingRestore(databasePath: string): boolean {
	const attente = pendingRestorePath(databasePath);
	if (!existsSync(attente)) return false;

	rmSync(`${databasePath}-wal`, { force: true });
	rmSync(`${databasePath}-shm`, { force: true });
	rmSync(databasePath, { force: true });
	renameSync(attente, databasePath);
	return true;
}
