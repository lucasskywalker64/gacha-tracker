import type {
    GameAdapter,
    NormalizedImportResult,
    NormalizedPull,
    ImportPayloadInput,
} from "@gacha-tracker/shared";
import { HSR_BANNERS, GAME_CONFIGS, banners } from "@gacha-tracker/shared";
import { computeGenericPity, findActivePhase } from "../pity";

const { pityConfig: hsrPityConfig } = GAME_CONFIGS["starrail"];

export const hsrAdapter: GameAdapter = {
    gameId: "starrail",
    displayName: "Honkai: Star Rail",
    bannerTypes: Object.values(HSR_BANNERS).map(String),
    pityConfig: hsrPityConfig,

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
                extra: rawPull.extra,
            };
        });

        return {
            gameUid: payload.gameUid,
            pulls,
        };
    },

    computePity(pulls: NormalizedPull[], bannerType: string): NormalizedPull[] {
        const has5050 =
            bannerType === String(HSR_BANNERS.CHARACTER) ||
            bannerType === String(HSR_BANNERS.WEAPON);
        const isCharacterBanner = bannerType === String(HSR_BANNERS.CHARACTER);
        const isWeaponBanner = bannerType === String(HSR_BANNERS.WEAPON);
        const hsrBanners = banners.games.hsr || [];

        // 5-Star Approximation Attribution Pass
        let currentSequence: NormalizedPull[] = [];
        const attributedPulls: NormalizedPull[] = [];

        for (let i = 0; i < pulls.length; i++) {
            const pull = pulls[i];
            currentSequence.push(pull);

            if (pull.rarity === hsrPityConfig.pityTriggerRarity) {
                const pullTime = pull.pulledAt.getTime();
                const activePhase = findActivePhase(pullTime, hsrBanners, pull.itemId);

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

                let sequenceBannerId = mainId || bannerType;

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

        // Handle any remaining pulls in the final incomplete sequence
        if (currentSequence.length > 0) {
            const lastPull = currentSequence[currentSequence.length - 1];
            const pullTime = lastPull.pulledAt.getTime();
            const activePhase = findActivePhase(pullTime, hsrBanners, lastPull.itemId);

            let mainId = "";
            if (activePhase) {
                mainId = isCharacterBanner
                    ? activePhase.mainCharacterId
                    : isWeaponBanner
                      ? activePhase.mainWeaponId
                      : "";
            }

            const sequenceBannerId = mainId || bannerType;

            for (const p of currentSequence) {
                p.bannerId = sequenceBannerId;
            }
            attributedPulls.push(...currentSequence);
        }

        // Generic Pity Pass
        return computeGenericPity(attributedPulls, hsrPityConfig, has5050, (pull) => {
            const pullTime = pull.pulledAt.getTime();
            const activePhase = findActivePhase(pullTime, hsrBanners, pull.itemId);

            if (!activePhase) {
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
