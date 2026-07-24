import { json } from '@sveltejs/kit';
import { sqlite } from '$lib/server/db';

export const GET = () => {
	try {
		sqlite.prepare('SELECT 1').get();
		return json({ ok: true, ts: Math.floor(Date.now() / 1000) });
	} catch (error) {
		return json({ ok: false, error: (error as Error).message }, { status: 503 });
	}
};
