import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

// Type helper used by shadcn-svelte components to support `bind:this` on underlying elements.
export type WithElementRef<T, E extends Element = Element> = T & {
	ref?: E | null;
};

export type WithoutChild<T> = Omit<T, 'child'>;
export type WithoutChildren<T> = Omit<T, 'children'>;
export type WithoutChildrenOrChild<T> = Omit<T, 'child' | 'children'>;
