import { treaty } from '@elysiajs/eden';
import type { App } from 'api';
import { PUBLIC_API_URL } from '$env/static/public';

export const api = treaty<App>(PUBLIC_API_URL, {
	fetch: {
		credentials: 'include'
	}
});
