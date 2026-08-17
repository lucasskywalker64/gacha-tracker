const f = String.fromCharCode;

/**
 * Decompresses a UTF-16 compressed string (produced by lz-string's compressToUTF16)
 * with a safety limit on the decompressed output size.
 */
export function decompressFromUTF16(
	compressed: string | null | undefined,
	maxDecompressedLength = 20 * 1024 * 1024
): string | null {
	if (compressed == null) return '';
	if (compressed === '') return null;

	return _decompress(
		compressed.length,
		16384,
		(index: number) => {
			const code = compressed.charCodeAt(index);
			return isNaN(code) ? 0 : code - 32;
		},
		maxDecompressedLength
	);
}

function _decompress(
	length: number,
	resetValue: number,
	getNextValue: (index: number) => number,
	maxDecompressedLength: number
): string | null {
	const dictionary: string[] = [];
	let enlargeIn = 4;
	let dictSize = 4;
	let numBits = 3;
	let entry: string;
	const result: string[] = [];
	let i: number;
	let w: string;
	let bits: number;
	let resb: number;
	let maxpower: number;
	let power: number;

	const data = {
		val: getNextValue(0),
		position: resetValue,
		index: 1
	};

	for (i = 0; i < 3; i += 1) {
		dictionary[i] = String(i);
	}

	bits = 0;
	maxpower = Math.pow(2, 2);
	power = 1;
	while (power !== maxpower) {
		resb = data.val & data.position;
		data.position >>= 1;
		if (data.position === 0) {
			data.position = resetValue;
			data.val = getNextValue(data.index++);
		}
		bits |= (resb > 0 ? 1 : 0) * power;
		power <<= 1;
	}

	let cStr = '';
	switch (bits) {
		case 0:
			bits = 0;
			maxpower = Math.pow(2, 8);
			power = 1;
			while (power !== maxpower) {
				resb = data.val & data.position;
				data.position >>= 1;
				if (data.position === 0) {
					data.position = resetValue;
					data.val = getNextValue(data.index++);
				}
				bits |= (resb > 0 ? 1 : 0) * power;
				power <<= 1;
			}
			cStr = f(bits);
			break;
		case 1:
			bits = 0;
			maxpower = Math.pow(2, 16);
			power = 1;
			while (power !== maxpower) {
				resb = data.val & data.position;
				data.position >>= 1;
				if (data.position === 0) {
					data.position = resetValue;
					data.val = getNextValue(data.index++);
				}
				bits |= (resb > 0 ? 1 : 0) * power;
				power <<= 1;
			}
			cStr = f(bits);
			break;
		case 2:
			return '';
	}

	dictionary[3] = cStr;
	w = cStr;
	result.push(cStr);
	let decompressedLength = cStr.length;

	if (decompressedLength > maxDecompressedLength) {
		throw new Error(
			`Decompressed size validation failed: exceeds safety limit of ${maxDecompressedLength} characters`
		);
	}

	while (true) {
		if (data.index > length) {
			return '';
		}

		bits = 0;
		maxpower = Math.pow(2, numBits);
		power = 1;
		while (power !== maxpower) {
			resb = data.val & data.position;
			data.position >>= 1;
			if (data.position === 0) {
				data.position = resetValue;
				data.val = getNextValue(data.index++);
			}
			bits |= (resb > 0 ? 1 : 0) * power;
			power <<= 1;
		}

		let cNum: number;
		switch (bits) {
			case 0:
				bits = 0;
				maxpower = Math.pow(2, 8);
				power = 1;
				while (power !== maxpower) {
					resb = data.val & data.position;
					data.position >>= 1;
					if (data.position === 0) {
						data.position = resetValue;
						data.val = getNextValue(data.index++);
					}
					bits |= (resb > 0 ? 1 : 0) * power;
					power <<= 1;
				}

				dictionary[dictSize++] = f(bits);
				cNum = dictSize - 1;
				enlargeIn--;
				break;
			case 1:
				bits = 0;
				maxpower = Math.pow(2, 16);
				power = 1;
				while (power !== maxpower) {
					resb = data.val & data.position;
					data.position >>= 1;
					if (data.position === 0) {
						data.position = resetValue;
						data.val = getNextValue(data.index++);
					}
					bits |= (resb > 0 ? 1 : 0) * power;
					power <<= 1;
				}
				dictionary[dictSize++] = f(bits);
				cNum = dictSize - 1;
				enlargeIn--;
				break;
			case 2:
				return result.join('');
			default:
				cNum = bits;
				break;
		}

		if (enlargeIn === 0) {
			enlargeIn = Math.pow(2, numBits);
			numBits++;
		}

		if (dictionary[cNum]) {
			entry = dictionary[cNum];
		} else {
			if (cNum === dictSize) {
				entry = w + w.charAt(0);
			} else {
				return null;
			}
		}

		result.push(entry);
		decompressedLength += entry.length;

		if (decompressedLength > maxDecompressedLength) {
			throw new Error(
				`Decompressed size validation failed: exceeds safety limit of ${maxDecompressedLength} characters`
			);
		}

		dictionary[dictSize++] = w + entry.charAt(0);
		enlargeIn--;

		w = entry;

		if (enlargeIn === 0) {
			enlargeIn = Math.pow(2, numBits);
			numBits++;
		}
	}
}

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
		const profilesMap = parsed?.profiles || { '1': { name: 'Default', key: '1' } };

		const activeProfiles: SrsProfileInfo[] = [];

		for (const [key, profileObj] of Object.entries(
			profilesMap as Record<string, { name?: string; key?: string }>
		)) {
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
