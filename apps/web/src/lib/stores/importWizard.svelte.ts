type WizardStatus = 'idle' | 'connecting' | 'listening' | 'success' | 'error' | 'timeout';

interface WizardState {
	step: number; // 1–4
	status: WizardStatus;
	token: string | null;
	cursors: Record<string, string> | null;
	result: { imported: number } | null;
	error: string | null;
}

export class ImportWizardStore {
	state = $state<WizardState>({
		step: 1,
		status: 'idle',
		token: null,
		cursors: null,
		result: null,
		error: null
	});

	nextStep() {
		if (this.state.step < 4) {
			this.state.step++;
		}
	}

	prevStep() {
		if (this.state.step > 1) {
			this.state.step--;
		}
	}

	goToStep(step: number) {
		if (step >= 1 && step <= 4) {
			this.state.step = step;
		}
	}

	setToken(token: string, cursors: Record<string, string> | null) {
		this.state.token = token;
		this.state.cursors = cursors;
	}

	setStatus(status: WizardStatus) {
		this.state.status = status;
	}

	setResult(result: { imported: number } | null) {
		this.state.result = result;
	}

	setError(error: string | null) {
		this.state.error = error;
		this.state.status = 'error';
	}

	reset() {
		this.state.step = 1;
		this.state.status = 'idle';
		this.state.token = null;
		this.state.cursors = null;
		this.state.result = null;
		this.state.error = null;
	}
}

export const importWizard = new ImportWizardStore();
