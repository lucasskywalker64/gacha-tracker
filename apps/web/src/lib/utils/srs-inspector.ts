import { decompressFromUTF16 } from '@gacha-tracker/shared';

export interface SrsProfileInfo {
	key: string;
	name: string;
	warpCount: number;
}

export interface SrsInspectionResult {
	isDat: boolean;
	profiles: SrsProfileInfo[];
}

/**
 * Inspects a Star Rail Station upload file client-side.
 * If it's a `.dat` file, decompresses and scans for profiles with warp data.
 */
export async function inspectStarRailStationFile(file: File): Promise<SrsInspectionResult> {
	const isDatExtension = file.name.toLowerCase().endsWith('.dat');

	// Read first few bytes to check for magic 'srs' header
	const headerSlice = await file.slice(0, 3).text();
	const isDat = isDatExtension || headerSlice === 'srs';

	if (!isDat) {
		return { isDat: false, profiles: [] };
	}

	try {
		const fullText = await file.text();
		const payload = fullText.startsWith('srs') ? fullText.slice(3) : fullText;
		const decompressed = decompressFromUTF16(payload);
		if (!decompressed) {
			return { isDat: true, profiles: [] };
		}

		const parsed = JSON.parse(decompressed);
		const stores = parsed?.data?.stores || {};
		const profilesMap: Record<string, { name?: string; key?: string }> = parsed?.profiles || {};
		const storeKeys = Object.keys(stores)
			.filter((k) => k.endsWith('_warp-v2'))
			.map((k) => k.slice(0, -'_warp-v2'.length));
		const profileEntries = Array.from(new Set([...Object.keys(profilesMap), ...storeKeys])).map(
			(key) => [key, profilesMap[key] ?? {}] as const
		);

		const activeProfiles: SrsProfileInfo[] = [];

		for (const [key, profileObj] of profileEntries) {
			const storeKey = `${key}_warp-v2`;
			const store = stores[storeKey];
			if (!store || typeof store !== 'object') continue;

			const itemKeys = [
				'items_1',
				'items_2',
				'items_11',
				'items_12',
				'items_21',
				'items_22'
			] as const;

			let warpCount = 0;
			for (const itemKey of itemKeys) {
				const arr = store[itemKey];
				if (Array.isArray(arr)) {
					warpCount += arr.length;
				}
			}

			if (warpCount > 0) {
				activeProfiles.push({
					key,
					name: profileObj.name || (key === '1' ? 'Default' : `Profile ${key}`),
					warpCount
				});
			}
		}

		return {
			isDat: true,
			profiles: activeProfiles
		};
	} catch (e) {
		console.warn('[srs-inspector] Failed to inspect DAT file client-side:', e);
		return { isDat: true, profiles: [] };
	}
}
