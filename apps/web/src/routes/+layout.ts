import { authClient } from '$lib/api/auth';

export const ssr = false;
export const prerender = true;

export const load = async () => {
	const { data: sessionData } = await authClient.getSession();
	return {
		session: sessionData ?? null
	};
};
