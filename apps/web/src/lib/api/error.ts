/**
 * Safely extracts a user-friendly error message from an API response error.
 * Handles Elysia/Eden Treaty structure, nested error objects, and fallbacks.
 */
export function extractApiError(error: unknown, fallback: string): string {
	if (error && typeof error === 'object' && 'value' in error) {
		const val = (error as { value?: unknown }).value;
		if (val && typeof val === 'object') {
			if ('error' in val) {
				const innerError = (val as { error?: unknown }).error;
				if (innerError && typeof innerError === 'object' && 'message' in innerError) {
					const msg = (innerError as { message?: unknown }).message;
					if (typeof msg === 'string') {
						return msg;
					}
				}
			}
			if ('message' in val) {
				const msg = (val as { message?: unknown }).message;
				if (typeof msg === 'string') {
					return msg;
				}
			}
		}
		if (typeof val === 'string' && val.trim() !== '') {
			return val;
		}
	}
	return fallback;
}
