import type {
    GameAdapter,
    NormalizedImportResult,
    NormalizedPull,
    ImportPayloadInput,
} from "@gacha-tracker/shared";
import { ZZZ_BANNERS, GAME_CONFIGS, banners } from "@gacha-tracker/shared";
import { computeGenericPity, findActivePhase } from "../pity";

const { pityConfig: zzzPityConfig } = GAME_CONFIGS["zzz"];

export const zzzAdapter: GameAdapter = {
    gameId: "zzz",
    displayName: "Zenless Zone Zero",
    bannerTypes: Object.values(ZZZ_BANNERS).map(String),
    pityConfig: zzzPityConfig,

    async normalizeImport(raw: unknown): Promise<NormalizedImportResult> {
        const payload = raw as ImportPayloadInput;

        const pulls: NormalizedPull[] = payload.pulls.map((rawPull) => {
            const rarityMap: Record<number, number> = {
                2: 3, // B-Rank -> 3★ equivalent
                3: 4, // A-Rank -> 4★ equivalent
                4: 5, // S-Rank -> 5★ equivalent
            };
            const sourceRarity = Number(rawPull.rarity);
            const normalizedRarity = rarityMap[sourceRarity] ?? sourceRarity;

            return {
                pullId: rawPull.pullId,
                gameUid: payload.gameUid,
                bannerType: rawPull.bannerType,
                bannerId: rawPull.bannerId,
                itemId: rawPull.itemId,
                itemName: rawPull.itemName,
                itemType: rawPull.itemType,
                rarity: normalizedRarity,
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

    computePity(pulls: NormalizedPull[], bannerType: string): NormalizedPull[] {
        const isCharacterBanner = bannerType === String(ZZZ_BANNERS.CHARACTER);
        const isWeaponBanner = bannerType === String(ZZZ_BANNERS.WEAPON);
        const has5050 = isCharacterBanner || isWeaponBanner;

        const zzzBanners = banners.games.zzz || [];

        // 5-Star Approximation Attribution Pass
        let currentSequence: NormalizedPull[] = [];
        const attributedPulls: NormalizedPull[] = [];

        for (let i = 0; i < pulls.length; i++) {
            const pull = pulls[i];
            currentSequence.push(pull);

            if (pull.rarity === zzzPityConfig.pityTriggerRarity) {
                const pullTime = pull.pulledAt.getTime();
                const activePhase = findActivePhase(pullTime, zzzBanners, pull.itemId);

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
            const activePhase = findActivePhase(pullTime, zzzBanners, lastPull.itemId);

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
        return computeGenericPity(attributedPulls, zzzPityConfig, has5050, (pull) => {
            const pullTime = pull.pulledAt.getTime();
            const activePhase = findActivePhase(pullTime, zzzBanners, pull.itemId);

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
