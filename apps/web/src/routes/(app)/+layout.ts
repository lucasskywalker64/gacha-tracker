import { createGuard } from '$lib/utils/auth-guards';

// Redirect to login if the user is NOT logged in
export const load = createGuard((session) => !session, '/login');
