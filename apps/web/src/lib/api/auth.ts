import { createAuthClient } from 'better-auth/client';
import { passkeyClient } from '@better-auth/passkey/client';
import { emailOTPClient } from 'better-auth/client/plugins';
import { PUBLIC_API_URL } from '$env/static/public';

export const authClient = createAuthClient({
	baseURL: PUBLIC_API_URL,
	basePath: '/auth',
	plugins: [passkeyClient(), emailOTPClient()]
});
