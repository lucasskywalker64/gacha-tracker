import { writable } from 'svelte/store';
import type { authClient } from '../api/auth';

type Session = typeof authClient.$Infer.Session;

export const authStore = writable<Session | null>(null);
