import type {
    GameAdapter,
    NormalizedImportResult,
    NormalizedPull,
    ImportPayloadInput,
} from "@gacha-tracker/shared";
import { HSR_BANNERS, GAME_CONFIGS } from "@gacha-tracker/shared";
import { computeGenericPity } from "../pity";

const { pityConfig: hsrPityConfig } = GAME_CONFIGS["starrail"];

export const HSR_STANDARD_ITEMS = {
    CHARACTER_HIMEKO: "1003",
    CHARACTER_WELT: "1004",
    CHARACTER_YANQING: "1016",
    CHARACTER_BRONYA: "1101",
    CHARACTER_GEPARD: "1104",
    CHARACTER_BAILU: "1211",
    CHARACTER_CLARA: "1214",
    LIGHT_CONE_NIGHT_ON_THE_MILKY_WAY: "23000",
    LIGHT_CONE_IN_THE_NAME_OF_THE_WORLD: "23001",
    LIGHT_CONE_BUT_THE_BATTLE_ISNT_OVER: "23002",
    LIGHT_CONE_MOMENT_OF_VICTORY: "23004",
    LIGHT_CONE_SOMETHING_IRREPLACEABLE: "23005",
    LIGHT_CONE_SLEEP_LIKE_THE_DEAD: "23012",
    LIGHT_CONE_TIME_WAITS_FOR_NO_ONE: "23013",
} as const;

const STANDARD_5_STAR_IDS: Set<string> = new Set(Object.values(HSR_STANDARD_ITEMS));

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
        const has5050 = bannerType === "11" || bannerType === "12";

        return computeGenericPity(pulls, hsrPityConfig, has5050, (pull) => {
            return STANDARD_5_STAR_IDS.has(pull.itemId);
        });
    },
};
