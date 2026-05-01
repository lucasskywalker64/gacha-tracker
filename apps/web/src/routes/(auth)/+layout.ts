import { createGuard } from '$lib/utils/auth-guards';

// Redirect to dashboard if the user is ALREADY logged in
export const load = createGuard((session) => !!session, '/dashboard');
