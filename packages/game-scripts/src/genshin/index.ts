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

async function fetchUigfDict() {
    const url = "https://api.uigf.org/dict/genshin/en.json";
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        const data = (await res.json()) as Record<string, number>;
        const map = new Map<string, string>();
        const reverseMap = new Map<string, string>();
        for (const [name, id] of Object.entries(data)) {
            const strId = id.toString();
            map.set(name.toLowerCase(), strId);
            reverseMap.set(strId, name);
        }
        return { map, reverseMap };
    } catch (error) {
        console.error(`Failed to fetch UIGF mapping for Genshin:`, error);
        return { map: new Map<string, string>(), reverseMap: new Map<string, string>() };
    }
}

async function fetchWikiPages(category: string) {
    const pages: WikiPage[] = [];
    let url = `https://genshin-impact.fandom.com/api.php?action=query&generator=categorymembers&gcmtitle=${category}&gcmlimit=50&prop=revisions&rvprop=content&rvslots=main&format=json`;
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
                url = `https://genshin-impact.fandom.com/api.php?action=query&generator=categorymembers&gcmtitle=${category}&gcmlimit=50&prop=revisions&rvprop=content&rvslots=main&format=json&gcmcontinue=${encodeURIComponent(data.continue.gcmcontinue)}`;
            } else {
                hasMore = false;
            }
        }
    } catch (error) {
        console.error(`Failed to fetch wiki pages for ${category}:`, error);
    }
    return pages;
}

function parseWishTemplate(text: string) {
    const extract = (regex: RegExp) => {
        const match = text.match(regex);
        return match ? match[1].trim() : null;
    };

    const name = extract(/\|\s*name\s*=\s*([^|\n]+)/i);
    const type = extract(/\|\s*type\s*=\s*([^|\n]+)/i);
    const startTime = extract(/\|\s*time_start\s*=\s*([^|\n]+)/i);
    const endTime = extract(/\|\s*time_end\s*=\s*([^|\n]+)/i);

    // Wish Pool extractions
    const char5F = extract(/\|\s*character_5_F\s*=\s*([^|\n]+)/i);
    const lc5F = extract(/\|\s*weapon_5_F\s*=\s*([^|\n]+)/i);
    const char5 = extract(/\|\s*character_5\s*=\s*([^|\n]+)/i);
    const lc5 = extract(/\|\s*weapon_5\s*=\s*([^|\n]+)/i);

    const preceding =
        extract(/\|\s*preceding\s*=\s*([^|\n]+)/i) || extract(/\|\s*previous\s*=\s*([^|\n]+)/i);

    // Extract Version (e.g. [[Version 1.0]], {{Change History|1.0}}, or placeholders like {{Change History|Luna VII}})
    const versionMatch =
        text.match(/\[\[Version\s+["']?([^\]"']+)["']?\]\]/i) ||
        text.match(/\{\{Change History\|([^}|]+)/i);
    const version = versionMatch ? versionMatch[1] : null;

    return { name, type, startTime, endTime, char5F, lc5F, char5, lc5, version, preceding };
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

export async function updateGenshinBanners() {
    console.log("Fetching UIGF mappings for Genshin...");
    const { map: uigfMap, reverseMap: uigfReverseMap } = await fetchUigfDict();

    console.log(`Loaded ${uigfMap.size} items from UIGF dictionary.`);

    console.log("Fetching Character Event Wishes from Fandom...");
    const charPages = await fetchWikiPages("Category:Character_Event_Wishes");
    console.log("Fetching Weapon Event Wishes from Fandom...");
    const weaponPages = await fetchWikiPages("Category:Weapon_Event_Wishes");
    console.log("Fetching Chronicled Wishes from Fandom...");
    const chronicledPages = await fetchWikiPages("Category:Chronicled_Wishes");

    const phasesMap = new Map<string, ProcessingPhase>();

    const processPage = (page: WikiPage, isChar: boolean, isChronicled: boolean) => {
        const content = page.revisions?.[0]?.slots?.main?.["*"];
        if (!content) return;

        const data = parseWishTemplate(content);
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
                hasRerun: !!data.preceding, // Internal use
            });
        }

        const phase = phasesMap.get(phaseKey)!;

        let charList = data.char5F;
        let weaponList = data.lc5F;

        if (isChronicled || (data.type && data.type.toLowerCase().includes("chronicled"))) {
            charList = data.char5;
            weaponList = data.lc5;
        }

        if (isChar && charList) {
            const characterNames = charList
                .split(/[,;]/)
                .map((name: string) => name.trim().toLowerCase());

            const isNewCharacterBanner = !data.preceding;

            for (const characterName of characterNames) {
                const characterId = uigfMap.get(characterName);
                if (characterId && !phase.featuredCharacters.includes(characterId)) {
                    phase.featuredCharacters.push(characterId);

                    // Priority Logic:
                    // 1. New characters (no 'preceding' field) always beat reruns.
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
        } else if (!isChar && weaponList) {
            const weaponNames = weaponList
                .split(/[,;]/)
                .map((name: string) => name.trim().toLowerCase());

            const isNewWeaponBanner = !data.preceding;

            for (const weaponName of weaponNames) {
                const weaponId = uigfMap.get(weaponName);
                if (weaponId && !phase.featuredWeapons.includes(weaponId)) {
                    phase.featuredWeapons.push(weaponId);

                    const isHigherId =
                        !phase.mainWeaponId || parseInt(weaponId) > parseInt(phase.mainWeaponId);

                    // Weapons follow the same priority logic
                    if (isNewWeaponBanner || isHigherId) {
                        if (!phase.mainWeaponId || isHigherId) {
                            phase.mainWeaponId = weaponId;
                        }
                    }
                }
            }
        }
    };

    console.log("Parsing pages...");
    charPages.forEach((page: WikiPage) => processPage(page, true, false));
    weaponPages.forEach((page: WikiPage) => processPage(page, false, false));
    chronicledPages.forEach((page: WikiPage) => {
        // Chronicled wish contains both characters and weapons in the same pool, so we process it as both
        processPage(page, true, true);
        processPage(page, false, true);
    });

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
                (characterId: string) => uigfReverseMap.get(characterId) || characterId
            );
            const weaponNames = phase.featuredWeapons.map(
                (weaponId: string) => uigfReverseMap.get(weaponId) || weaponId
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

    console.log(`Generated ${sortedPhases.length} distinct banner phases for Genshin.`);

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

    const previousCount = existingData.games.genshin?.length || 0;
    if (nextPhases.length === 0 || (previousCount > 0 && nextPhases.length < previousCount)) {
        throw new Error(
            `Validation failed: scraped ${nextPhases.length} Genshin phases, but expected at least ${previousCount}. Aborting write to prevent data loss.`
        );
    }

    existingData.games.genshin = nextPhases;

    fs.writeFileSync(BANNERS_PATH, JSON.stringify(existingData, null, 4));
    console.log("Successfully updated banners.json for Genshin");
}
