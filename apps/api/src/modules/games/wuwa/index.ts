import type {
    GameAdapter,
    NormalizedImportResult,
    NormalizedPull,
    ImportPayloadInput,
} from "@gacha-tracker/shared";
import { WUWA_BANNERS, GAME_CONFIGS, banners } from "@gacha-tracker/shared";
import { computeGenericPity, findActivePhase } from "../pity";

const { pityConfig: wuwaPityConfig } = GAME_CONFIGS["wuwa"];

export const wuwaAdapter: GameAdapter = {
    gameId: "wuwa",
    displayName: "Wuthering Waves",
    bannerTypes: Object.values(WUWA_BANNERS).map(String),
    pityConfig: wuwaPityConfig,

    async normalizeImport(raw: unknown): Promise<NormalizedImportResult> {
        const payload = raw as ImportPayloadInput;

        const pulls: NormalizedPull[] = payload.pulls.map((rawPull) => {
            return {
                pullId: rawPull.pullId,
                gameUid: payload.gameUid,
                bannerType: rawPull.bannerType,
                bannerId: rawPull.bannerId,
                itemId: rawPull.itemId,
                itemName: rawPull.itemName,
                itemType: rawPull.itemType,
                rarity: rawPull.rarity,
                pulledAt: new Date(rawPull.pulledAt),
                pityAtPull: 0,
                wasGuaranteed: 0,
            };
        });

        return {
            gameUid: payload.gameUid,
            pulls,
        };
    },

    computePity(pulls: NormalizedPull[], poolKey: string): NormalizedPull[] {
        const has5050 =
            poolKey === String(WUWA_BANNERS.CHARACTER) ||
            poolKey === String(WUWA_BANNERS.COLLAB_CHARACTER) ||
            poolKey === String(WUWA_BANNERS.REVERB_CHARACTER);
        const isCharacterBanner =
            poolKey === String(WUWA_BANNERS.CHARACTER) ||
            poolKey === String(WUWA_BANNERS.COLLAB_CHARACTER) ||
            poolKey === String(WUWA_BANNERS.REVERB_CHARACTER);
        const isWeaponBanner =
            poolKey === String(WUWA_BANNERS.WEAPON) ||
            poolKey === String(WUWA_BANNERS.COLLAB_WEAPON) ||
            poolKey === String(WUWA_BANNERS.REVERB_WEAPON);

        const wuwaBanners = banners.games.wuwa || [];

        // 5-Star Approximation Attribution Pass
        let currentSequence: NormalizedPull[] = [];
        const attributedPulls: NormalizedPull[] = [];

        for (let i = 0; i < pulls.length; i++) {
            const pull = pulls[i];
            currentSequence.push(pull);

            if (pull.rarity === wuwaPityConfig.pityTriggerRarity) {
                const pullTime = pull.pulledAt.getTime();
                const activePhase = findActivePhase(pullTime, wuwaBanners, pull.itemId);

                let featuredIds: string[] = [];
                let mainId = "";

                if (activePhase) {
                    if (isCharacterBanner) {
                        featuredIds = activePhase.featuredCharacters;
                        mainId = activePhase.mainCharacterId;
                    } else if (isWeaponBanner) {
                        featuredIds = activePhase.featuredWeapons;
                        mainId = activePhase.mainWeaponId;
                    }
                }

                let sequenceBannerId = mainId || pull.bannerType;

                if (has5050 && activePhase) {
                    if (featuredIds.includes(pull.itemId)) {
                        sequenceBannerId = pull.itemId;
                    } else {
                        sequenceBannerId = mainId;
                    }
                }

                for (const p of currentSequence) {
                    p.bannerId = sequenceBannerId;
                }

                attributedPulls.push(...currentSequence);
                currentSequence = [];
            }
        }

        if (currentSequence.length > 0) {
            const lastPull = currentSequence[currentSequence.length - 1];
            const pullTime = lastPull.pulledAt.getTime();
            const activePhase = findActivePhase(pullTime, wuwaBanners, lastPull.itemId);

            let mainId = "";
            if (activePhase) {
                mainId = isCharacterBanner
                    ? activePhase.mainCharacterId
                    : isWeaponBanner
                      ? activePhase.mainWeaponId
                      : "";
            }

            const sequenceBannerId = mainId || lastPull.bannerType;

            for (const p of currentSequence) {
                p.bannerId = sequenceBannerId;
            }
            attributedPulls.push(...currentSequence);
        }

        // Generic Pity Pass
        return computeGenericPity(attributedPulls, wuwaPityConfig, has5050, (pull) => {
            const pullTime = pull.pulledAt.getTime();
            const activePhase = findActivePhase(pullTime, wuwaBanners, pull.itemId);

            if (!activePhase) {
                // FALLBACK: If active phase is not found (e.g. newly launched Reverb banners not yet scraped),
                // detect a lost 50/50 by checking if the pulled 5-star character is one of the standard characters.
                if (isCharacterBanner) {
                    return ["1503", "1203", "1301", "1104", "1405"].includes(pull.itemId);
                }
                return false;
            }

            if (isCharacterBanner) {
                return !activePhase.featuredCharacters.includes(pull.itemId);
            } else if (isWeaponBanner) {
                return !activePhase.featuredWeapons.includes(pull.itemId);
            }

            return false;
        });
    },
};
