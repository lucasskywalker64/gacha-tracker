import { writable } from 'svelte/store';

export type SupportedGame = 'genshin' | 'starrail' | 'zzz' | 'wuwa';

export const selectedGame = writable<SupportedGame>('genshin');
