import { treaty } from '@elysiajs/eden';
import type { App } from 'api';

const url = import.meta.env.VITE_API_URL || 'http://localhost:3000';
// @ts-expect-error - Elysia version mismatch in monorepo
export const api = treaty<App>(url);
