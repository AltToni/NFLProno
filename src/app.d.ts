declare global {
	namespace App {
		interface SessionUser {
			id: number;
			pseudo: string;
			email: string;
			role: 'admin' | 'joueur';
			avatar: string | null;
		}

		interface Locals {
			user: SessionUser | null;
		}

		interface PageData {
			user: SessionUser | null;
		}
	}
}

export {};
