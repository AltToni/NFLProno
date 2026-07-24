import type { LayoutServerLoad } from './$types';
import { requireAdmin } from '$lib/server/guards';

export const load: LayoutServerLoad = async ({ locals }) => {
	requireAdmin(locals);
	return {};
};
