import { PUBLIC_API_URL } from '$env/static/public';
import type { ImportWizardStore } from './importWizard.svelte';

let activeEs: EventSource | null = null;

export function connectImportSse(gameId: string, wizardStore: ImportWizardStore) {
	if (activeEs) return; // idempotent

	const url = `${PUBLIC_API_URL}/pulls/import/events?gameId=${gameId}`;
	console.log(`[SSE:Connect] Connecting to ${url}`);
	activeEs = new EventSource(url, { withCredentials: true });

	wizardStore.setStatus('connecting');

	activeEs.onmessage = (e) => {
		console.log('[SSE:Message]', e.data);
		const data = JSON.parse(e.data);

		if (data.type === 'started') {
			// Script has begun — auto-advance from Step 2 to Step 3
			wizardStore.goToStep(3);
			wizardStore.setStatus('listening');
		} else if (data.type === 'complete') {
			// Import finished — advance to Step 4
			wizardStore.setResult({ imported: data.imported });
			wizardStore.setStatus('success');
			wizardStore.goToStep(4);
			activeEs?.close();
			activeEs = null;
		} else if (data.type === 'timeout') {
			console.warn('[SSE:Timeout]');
			wizardStore.setStatus('timeout');
			activeEs?.close();
			activeEs = null;
		}
	};

	activeEs.onerror = (err) => {
		console.error('[SSE:Error]', err);
		wizardStore.setStatus('error');
		activeEs?.close();
		activeEs = null;
	};
}

export function disconnectImportSse() {
	activeEs?.close();
	activeEs = null;
}
