import { createAuthClient } from 'better-auth/client';
import { passkeyClient } from '@better-auth/passkey/client';
import { magicLinkClient } from 'better-auth/client/plugins';

const url = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export const authClient = createAuthClient({
	baseURL: url,
	plugins: [passkeyClient(), magicLinkClient()]
});
