import type {
    GameAdapter,
    NormalizedImportResult,
    NormalizedPull,
    ImportPayloadInput,
} from "@gacha-tracker/shared";
import { GENSHIN_BANNERS, GAME_CONFIGS, banners, type BannerPhase } from "@gacha-tracker/shared";
import { computeGenericPity } from "../pity";

const { pityConfig: genshinPityConfig } = GAME_CONFIGS["genshin"];

function findActivePhase(time: number, bannersList: BannerPhase[]): BannerPhase | undefined {
    return bannersList.find((b) => time >= b.startTime && (!b.endTime || time <= b.endTime));
}

export const genshinAdapter: GameAdapter = {
    gameId: "genshin",
    displayName: "Genshin Impact",
    bannerTypes: Object.values(GENSHIN_BANNERS).map(String),
    pityConfig: genshinPityConfig,

    pityPools: {
        [GENSHIN_BANNERS.CHARACTER]: "limited_character",
        [GENSHIN_BANNERS.CHARACTER_2]: "limited_character",
    },

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

    computePity(pulls: NormalizedPull[], poolKey: string): NormalizedPull[] {
        const isLimitedCharacter = poolKey === "limited_character";
        const isWeaponBanner = poolKey === String(GENSHIN_BANNERS.WEAPON);
        const has5050 = isLimitedCharacter || isWeaponBanner;

        const genshinBanners = banners.games.genshin || [];

        // 5-Star Approximation Attribution Pass
        let currentSequence: NormalizedPull[] = [];
        const attributedPulls: NormalizedPull[] = [];

        for (let i = 0; i < pulls.length; i++) {
            const pull = pulls[i];
            currentSequence.push(pull);

            if (pull.rarity === genshinPityConfig.pityTriggerRarity) {
                const pullTime = pull.pulledAt.getTime();
                const activePhase = findActivePhase(pullTime, genshinBanners);

                let featuredIds: string[] = [];
                let mainId = "";

                if (activePhase) {
                    if (isLimitedCharacter) {
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
            const activePhase = findActivePhase(pullTime, genshinBanners);

            let mainId = "";
            if (activePhase) {
                mainId = isLimitedCharacter
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
        return computeGenericPity(attributedPulls, genshinPityConfig, has5050, (pull) => {
            const pullTime = pull.pulledAt.getTime();
            const activePhase = findActivePhase(pullTime, genshinBanners);

            if (!activePhase) {
                return false;
            }

            if (isLimitedCharacter) {
                return !activePhase.featuredCharacters.includes(pull.itemId);
            } else if (isWeaponBanner) {
                return !activePhase.featuredWeapons.includes(pull.itemId);
            }

            return false;
        });
    },
};
