import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { type BannerPhase, type BannersData } from "../../../shared/src/data/index";

interface ProcessingPhase extends BannerPhase {
    version?: string;
    hasRerun?: boolean;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BANNERS_PATH = path.resolve(__dirname, "../../../shared/src/data/banners.json");

interface WikiPage {
    pageid: number;
    title: string;
    revisions?: {
        slots: {
            main: {
                "*": string;
            };
        };
    }[];
}

async function fetchMapping(type: "characters" | "light_cones") {
    const url = `https://raw.githubusercontent.com/Mar-7th/StarRailRes/master/index_min/en/${type}.json`;
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        const data = (await res.json()) as Record<
            string,
            { name: string; id: string; rarity: number }
        >;
        const map = new Map<string, string>();
        const reverseMap = new Map<string, string>();
        for (const key in data) {
            const item = data[key];
            if (item.name === "{NICKNAME}") continue;
            map.set(item.name.toLowerCase(), item.id);
            reverseMap.set(item.id, item.name);
        }
        return { map, reverseMap, rawData: data };
    } catch (error) {
        console.error(`Failed to fetch ${type} mapping:`, error);
        return {
            map: new Map<string, string>(),
            reverseMap: new Map<string, string>(),
            rawData: null,
        };
    }
}

async function fetchWikiPages(category: string) {
    const pages: WikiPage[] = [];
    let url = `https://honkai-star-rail.fandom.com/api.php?action=query&generator=categorymembers&gcmtitle=${category}&gcmlimit=50&prop=revisions&rvprop=content&rvslots=main&format=json`;
    let hasMore = true;

    try {
        while (hasMore) {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
            const data = await res.json();

            if (data.query && data.query.pages) {
                for (const key in data.query.pages) {
                    pages.push(data.query.pages[key]);
                }
            }

            if (data.continue && data.continue.gcmcontinue) {
                url = `https://honkai-star-rail.fandom.com/api.php?action=query&generator=categorymembers&gcmtitle=${category}&gcmlimit=50&prop=revisions&rvprop=content&rvslots=main&format=json&gcmcontinue=${encodeURIComponent(data.continue.gcmcontinue)}`;
            } else {
                hasMore = false;
            }
        }
    } catch (error) {
        console.error(`Failed to fetch wiki pages for ${category}:`, error);
    }
    return pages;
}

function parseWarpTemplate(text: string) {
    const extract = (regex: RegExp) => {
        const match = text.match(regex);
        return match ? match[1].trim() : null;
    };

    const name = extract(/\|\s*name\s*=\s*([^|\n]+)/i);
    const startTime = extract(/\|\s*time_start\s*=\s*([^|\n]+)/i);
    const endTime = extract(/\|\s*time_end\s*=\s*([^|\n]+)/i);
    const char5F = extract(/\|\s*character_5_F\s*=\s*([^|\n]+)/i);
    const lc5F = extract(/\|\s*lightcone_5_F\s*=\s*([^|\n]+)/i);
    const previous = extract(/\|\s*previous\s*=\s*([^|\n]+)/i);

    // Extract Version (e.g. [[Version 1.0]] or {{Change History|1.0}})
    const versionMatch =
        text.match(/\[\[Version\s+([\d.]+)/i) || text.match(/\{\{Change History\|([\d.]+)/i);
    const version = versionMatch ? versionMatch[1] : null;

    return { name, startTime, endTime, char5F, lc5F, version, previous };
}

function parseDate(dateStr: string): number | null {
    if (!dateStr) return null;

    dateStr = dateStr.replace(/\[\[|\]\]/g, "").trim();
    dateStr = dateStr.split("<")[0].trim();

    // Standardize format: 2024-05-22 10:00:00
    let normalized = dateStr.replace(/(\d{4}-\d{2}-\d{2})\s+(\d):/, "$1 0$2:");

    // Add time if missing (e.g. 2024-05-22)
    if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
        normalized += " 00:00:00";
    }

    // Assume UTC+8 if no offset is present
    const hasOffset = /GMT|UTC|[+-]\d{2}:?\d{2}/i.test(dateStr);
    const isoString = hasOffset
        ? normalized.replace(" ", "T")
        : `${normalized.replace(" ", "T")}+08:00`;

    const timestamp = new Date(isoString).getTime();
    return isNaN(timestamp) ? null : timestamp;
}

export async function updateHsrBanners() {
    console.log("Fetching StarRailRes mappings...");
    const {
        map: charMap,
        reverseMap: charReverseMap,
        rawData: charRawData,
    } = await fetchMapping("characters");
    const {
        map: weaponMap,
        reverseMap: weaponReverseMap,
        rawData: weaponRawData,
    } = await fetchMapping("light_cones");

    console.log(`Loaded ${charMap.size} characters and ${weaponMap.size} weapons.`);

    console.log("Fetching Character Event Warps from Fandom...");
    const charPages = await fetchWikiPages("Category:Character_Event_Warps");
    console.log("Fetching Light Cone Event Warps from Fandom...");
    const weaponPages = await fetchWikiPages("Category:Light_Cone_Event_Warps");

    const phasesMap = new Map<string, ProcessingPhase>();

    const processPage = (page: WikiPage, isChar: boolean) => {
        const content = page.revisions?.[0]?.slots?.main?.["*"];
        if (!content) return;

        const data = parseWarpTemplate(content);
        if (!data.startTime || !data.endTime) return;

        const startTimestamp = parseDate(data.startTime);
        const endTimestamp = parseDate(data.endTime);

        if (!startTimestamp) {
            console.log(
                `[DEBUG] Failed to parse startTime: "${data.startTime}" for page: ${page.title}`
            );
            return;
        }

        if (!endTimestamp) {
            console.log(
                `[DEBUG] Failed to parse endTime: "${data.endTime}" for page: ${page.title}`
            );
            return;
        }

        // Group by start/end time with 2 hour tolerance (handles wiki inconsistencies)
        let phaseKey = "";
        for (const [key] of Array.from(phasesMap.entries())) {
            const [kStart, kEnd] = key.split("_").map(Number);
            const startDiff = Math.abs(kStart - startTimestamp);
            const endDiff = endTimestamp && kEnd ? Math.abs(kEnd - endTimestamp) : 0;

            if (startDiff <= 2 * 3600 * 1000 && endDiff <= 2 * 3600 * 1000) {
                phaseKey = key;
                break;
            }
        }

        if (!phaseKey) {
            phaseKey = `${startTimestamp}_${endTimestamp}`;
            phasesMap.set(phaseKey, {
                phase: "",
                name: "",
                featuredCharacters: [],
                mainCharacterId: "",
                featuredWeapons: [],
                mainWeaponId: "",
                startTime: startTimestamp,
                endTime: endTimestamp,
                version: data.version || "Unknown",
                hasRerun: !!data.previous, // Internal use
            });
        }

        const phase = phasesMap.get(phaseKey)!;

        if (isChar && data.char5F) {
            const characterNames = data.char5F
                .split(/[,;]/)
                .map((name: string) => name.trim().toLowerCase());

            const isNewCharacterBanner = !data.previous;

            for (const characterName of characterNames) {
                const characterId = charMap.get(characterName);
                if (characterId && !phase.featuredCharacters.includes(characterId)) {
                    phase.featuredCharacters.push(characterId);

                    // Priority Logic:
                    // 1. New characters (no 'previous' field) always beat reruns.
                    // 2. If both are new or both are reruns, the one with the higher ID wins (latest character).
                    const currentMainIsRerun = phase.hasRerun;
                    const isHigherId =
                        !phase.mainCharacterId ||
                        parseInt(characterId) > parseInt(phase.mainCharacterId);

                    if (isNewCharacterBanner) {
                        if (currentMainIsRerun || isHigherId) {
                            phase.mainCharacterId = characterId;
                            phase.hasRerun = false;
                        }
                    } else {
                        // Current banner is a rerun
                        if (!phase.mainCharacterId || (currentMainIsRerun && isHigherId)) {
                            phase.mainCharacterId = characterId;
                            phase.hasRerun = true;
                        }
                    }
                }
            }
        } else if (!isChar && data.lc5F) {
            const weaponNames = data.lc5F
                .split(/[,;]/)
                .map((name: string) => name.trim().toLowerCase());

            const isNewWeaponBanner = !data.previous;

            for (const weaponName of weaponNames) {
                const weaponId = weaponMap.get(weaponName);
                if (weaponId && !phase.featuredWeapons.includes(weaponId)) {
                    phase.featuredWeapons.push(weaponId);

                    const isHigherId =
                        !phase.mainWeaponId || parseInt(weaponId) > parseInt(phase.mainWeaponId);

                    // Weapons follow the same priority logic (Internal flag not needed as they usually match characters)
                    if (isNewWeaponBanner || isHigherId) {
                        // We don't track hasRerun separately for Weapons, but we prioritize new ones
                        if (!phase.mainWeaponId || isHigherId) {
                            phase.mainWeaponId = weaponId;
                        }
                    }
                }
            }
        }
    };

    console.log("Parsing pages...");
    charPages.forEach((page: WikiPage) => processPage(page, true));
    weaponPages.forEach((page: WikiPage) => processPage(page, false));

    const sortedPhases = Array.from(phasesMap.values()).sort(
        (phaseA: ProcessingPhase, phaseB: ProcessingPhase) => phaseA.startTime - phaseB.startTime
    );

    // Post-process to calculate phase numbers and names
    const versionGroups = new Map<string, ProcessingPhase[]>();
    for (const phase of sortedPhases) {
        const v = phase.version || "Unknown";
        if (!versionGroups.has(v)) versionGroups.set(v, []);
        versionGroups.get(v)!.push(phase);
    }

    for (const [version, phases] of Array.from(versionGroups.entries())) {
        // Sort phases within the version by startTime
        phases.sort(
            (phaseA: ProcessingPhase, phaseB: ProcessingPhase) =>
                phaseA.startTime - phaseB.startTime
        );
        phases.forEach((phase: ProcessingPhase, phaseIndex: number) => {
            phase.phase =
                version === "Unknown" ? `Phase_${phase.startTime}` : `${version}.${phaseIndex + 1}`;

            // Ensure main character and light cone are always first in the list for better readability
            if (phase.mainCharacterId) {
                phase.featuredCharacters = [
                    phase.mainCharacterId,
                    ...phase.featuredCharacters.filter((id) => id !== phase.mainCharacterId),
                ];
            }
            if (phase.mainWeaponId) {
                phase.featuredWeapons = [
                    phase.mainWeaponId,
                    ...phase.featuredWeapons.filter((id) => id !== phase.mainWeaponId),
                ];
            }

            const charNames = phase.featuredCharacters.map(
                (characterId: string) => charReverseMap.get(characterId) || characterId
            );
            const weaponNames = phase.featuredWeapons.map(
                (weaponId: string) => weaponReverseMap.get(weaponId) || weaponId
            );

            if (charNames.length > 0) {
                phase.name = charNames.join(" / ");
            } else if (weaponNames.length > 0) {
                phase.name = weaponNames.join(" / ");
            }

            // Clean up internal fields before saving
            delete phase.version;
            delete phase.hasRerun;
        });
    }

    console.log(`Generated ${sortedPhases.length} distinct banner phases.`);

    const nextPhases = sortedPhases.filter(
        (p) => p.featuredCharacters.length > 0 || p.featuredWeapons.length > 0
    );

    let existingData: BannersData = { games: { hsr: [], genshin: [], zzz: [], wuwa: [] } };
    if (fs.existsSync(BANNERS_PATH)) {
        try {
            existingData = JSON.parse(fs.readFileSync(BANNERS_PATH, "utf-8"));
        } catch (error) {
            throw new Error(`Failed to parse banners.json: ${String(error)}`, { cause: error });
        }
    }

    const previousCount = existingData.games.hsr?.length || 0;
    if (nextPhases.length === 0 || (previousCount > 0 && nextPhases.length < previousCount)) {
        throw new Error(
            `Validation failed: scraped ${nextPhases.length} HSR phases, but expected at least ${previousCount}. Aborting write to prevent data loss.`
        );
    }

    existingData.games.hsr = nextPhases;

    fs.writeFileSync(BANNERS_PATH, JSON.stringify(existingData, null, 4));
    console.log("Successfully updated banners.json for HSR");

    // Compile and write srgf_dict.json
    const srgfDict: Record<string, { name: string; rarity: number; type: string }> = {};

    if (charRawData) {
        for (const [id, char] of Object.entries(charRawData)) {
            if (char.name === "{NICKNAME}") continue;
            srgfDict[id] = {
                name: char.name,
                rarity: char.rarity,
                type: "Character",
            };
        }
    }

    if (weaponRawData) {
        for (const [id, weapon] of Object.entries(weaponRawData)) {
            srgfDict[id] = {
                name: weapon.name,
                rarity: weapon.rarity,
                type: "Light Cone",
            };
        }
    }

    const DICT_PATH = path.resolve(__dirname, "../../../shared/src/data/srgf_dict.json");
    fs.writeFileSync(DICT_PATH, JSON.stringify(srgfDict, null, 4));
    console.log("Successfully updated srgf_dict.json for HSR");
}
