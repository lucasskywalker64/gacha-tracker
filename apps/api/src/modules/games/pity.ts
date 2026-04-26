import type { NormalizedPull, PityConfig } from "@gacha-tracker/shared";

/**
 * Computes the pity counter and guarantee status for a chronological array of pulls.
 *
 * @param chronologicalPulls Array of pulls sorted oldest-first.
 * @param config The pity configuration for the current game.
 * @param has5050 Whether the current banner tracks a 50/50 guarantee (e.g., limited banners).
 * @param isStandardItem Callback to check if a triggered 5-star is a standard item (i.e., a lost 50/50).
 */
export function computeGenericPity(
    chronologicalPulls: NormalizedPull[],
    config: PityConfig,
    has5050: boolean,
    isStandardItem: (pull: NormalizedPull) => boolean
): NormalizedPull[] {
    let currentPity = 0;
    let isGuaranteed = false;

    return chronologicalPulls.map((pull) => {
        currentPity += 1;

        const computedPull = {
            ...pull,
            pityAtPull: currentPity,
            wasGuaranteed: has5050 ? (isGuaranteed ? 1 : 0) : 0,
        };

        if (pull.rarity === config.pityTriggerRarity) {
            currentPity = 0;

            if (has5050) {
                if (isStandardItem(pull)) {
                    isGuaranteed = true;
                } else {
                    isGuaranteed = false;
                }
            }
        }

        return computedPull;
    });
}
