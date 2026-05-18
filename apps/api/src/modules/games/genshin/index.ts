import type {
    GameAdapter,
    NormalizedImportResult,
    NormalizedPull,
    ImportPayloadInput,
} from "@gacha-tracker/shared";
import { GENSHIN_BANNERS, GAME_CONFIGS, banners } from "@gacha-tracker/shared";
import { computeGenericPity, findActivePhase } from "../pity";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uigfDictPath = path.resolve(__dirname, "./uigf_dict.json");
let uigfDictLocal: Record<string, number> = {};
try {
    if (fs.existsSync(uigfDictPath)) {
        uigfDictLocal = JSON.parse(fs.readFileSync(uigfDictPath, "utf-8"));
    }
} catch (e) {
    console.error("Failed to load local UIGF dictionary:", e);
}

// In-memory cache of UIGF mapping (name -> string ID)
const uigfMap: Record<string, string> = {};
for (const [name, id] of Object.entries(uigfDictLocal)) {
    uigfMap[name.toLowerCase()] = String(id);
}

// Keep track of initialization to fetch latest dict from api.uigf.org in background
let initialized = false;
async function ensureUigfDict() {
    if (initialized) return;
    initialized = true;
    try {
        const res = await fetch("https://api.uigf.org/dict/genshin/en.json", {
            signal: AbortSignal.timeout(3000),
        });
        if (res.ok) {
            const data = (await res.json()) as Record<string, number>;
            for (const [name, id] of Object.entries(data)) {
                uigfMap[name.toLowerCase()] = String(id);
            }
        }
    } catch {
        // Fall back gracefully to local dict
    }
}

const { pityConfig: genshinPityConfig } = GAME_CONFIGS["genshin"];

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

        // Try to fetch latest dictionary from UIGF in the background if not done already
        ensureUigfDict().catch(() => {});

        const pulls: NormalizedPull[] = payload.pulls.map((rawPull) => {
            // Resolve empty itemId using UIGF dictionary or item name itself
            let itemId = rawPull.itemId;
            if (!itemId || itemId.trim() === "") {
                const nameKey = rawPull.itemName.trim().toLowerCase();
                itemId = uigfMap[nameKey] || rawPull.itemName;
            }

            return {
                pullId: rawPull.pullId,
                gameUid: payload.gameUid,
                bannerType: rawPull.bannerType,
                bannerId: rawPull.bannerId,
                itemId,
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
                const activePhase = findActivePhase(pullTime, genshinBanners, pull.itemId);

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
            const activePhase = findActivePhase(pullTime, genshinBanners, lastPull.itemId);

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
            const activePhase = findActivePhase(pullTime, genshinBanners, pull.itemId);

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
