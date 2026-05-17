import type {
    GameAdapter,
    NormalizedImportResult,
    NormalizedPull,
    ImportPayloadInput,
} from "@gacha-tracker/shared";
import { WUWA_BANNERS, GAME_CONFIGS, banners, type BannerPhase } from "@gacha-tracker/shared";
import { computeGenericPity } from "../pity";

const { pityConfig: wuwaPityConfig } = GAME_CONFIGS["wuwa"];

function findActivePhase(
    time: number,
    bannersList: BannerPhase[],
    itemId?: string
): BannerPhase | undefined {
    const activePhases = bannersList.filter(
        (b) => time >= b.startTime && (!b.endTime || time <= b.endTime)
    );
    if (activePhases.length === 0) return undefined;
    if (activePhases.length === 1) return activePhases[0];

    if (itemId) {
        const matchingPhase = activePhases.find(
            (b) =>
                b.featuredCharacters?.includes(itemId) ||
                b.featuredWeapons?.includes(itemId) ||
                b.mainCharacterId === itemId ||
                b.mainWeaponId === itemId
        );
        if (matchingPhase) return matchingPhase;
    }

    return activePhases[0];
}

export const wuwaAdapter: GameAdapter = {
    gameId: "wuwa",
    displayName: "Wuthering Waves",
    bannerTypes: Object.values(WUWA_BANNERS).map(String),
    pityConfig: wuwaPityConfig,

    async normalizeImport(raw: unknown): Promise<NormalizedImportResult> {
        const payload = raw as ImportPayloadInput;

        const pulls: NormalizedPull[] = payload.pulls.map((rawPull) => {
            const recordId = rawPull.extra?.recordId as string | undefined;
            const resourceId = rawPull.extra?.resourceId as string | undefined;
            const qualityLevel = rawPull.extra?.qualityLevel as number | undefined;
            const cardPoolType = rawPull.extra?.cardPoolType as number | undefined;

            return {
                pullId: recordId || rawPull.pullId,
                gameUid: payload.gameUid,
                bannerType: cardPoolType ? String(cardPoolType) : rawPull.bannerType,
                bannerId: rawPull.bannerId,
                itemId: resourceId || rawPull.itemId,
                itemName: rawPull.itemName,
                itemType: rawPull.itemType,
                rarity: qualityLevel || rawPull.rarity,
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
        const has5050 =
            poolKey === String(WUWA_BANNERS.CHARACTER) || poolKey === String(WUWA_BANNERS.WEAPON);
        const isCharacterBanner = poolKey === String(WUWA_BANNERS.CHARACTER);
        const isWeaponBanner = poolKey === String(WUWA_BANNERS.WEAPON);

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
