import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { type BannerPhase, type BannersData } from "../../../shared/src/data/index";

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

interface ProcessingPhase extends BannerPhase {
    version?: string;
    isNew?: boolean;
    metadata?: { mainIsRerun?: boolean };
}

async function fetchWuwaMapping() {
    const map = new Map<string, string>();
    const reverseMap = new Map<string, string>();

    try {
        console.log("Fetching characters from Encore.moe...");
        const charRes = await fetch("https://api-v2.encore.moe/api/en/character");
        if (charRes.ok) {
            const data = await charRes.json();
            const list = data.roleList || [];
            for (const item of list) {
                if (item.Name.toLowerCase().includes("rover")) continue;
                map.set(item.Name.toLowerCase(), item.Id.toString());
                reverseMap.set(item.Id.toString(), item.Name);
            }
        }

        console.log("Fetching weapons from Encore.moe...");
        const weapRes = await fetch("https://api-v2.encore.moe/api/en/weapon");
        if (weapRes.ok) {
            const data = await weapRes.json();
            const list = data.weapons || [];
            for (const item of list) {
                map.set(item.Name.toLowerCase(), item.Id.toString());
                reverseMap.set(item.Id.toString(), item.Name);
            }
        }
    } catch (error) {
        console.error("Failed to fetch WuWa mapping from Encore.moe:", error);
    }

    return { map, reverseMap };
}

async function fetchWikiPages(category: string) {
    const pages: WikiPage[] = [];
    let url = `https://wutheringwaves.fandom.com/api.php?action=query&generator=categorymembers&gcmtitle=${category}&gcmlimit=50&prop=revisions&rvprop=content&rvslots=main&format=json`;
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
                url = `https://wutheringwaves.fandom.com/api.php?action=query&generator=categorymembers&gcmtitle=${category}&gcmlimit=50&prop=revisions&rvprop=content&rvslots=main&format=json&gcmcontinue=${encodeURIComponent(data.continue.gcmcontinue)}`;
            } else {
                hasMore = false;
            }
        }
    } catch (error) {
        console.error(`Failed to fetch wiki pages for ${category}:`, error);
    }
    return pages;
}

function parseConveneTemplate(text: string) {
    const extract = (regex: RegExp) => {
        const match = text.match(regex);
        return match ? match[1].trim() : null;
    };

    const name = extract(/\|\s*name\s*=\s*([^|\n]+)/i);
    const startTime = extract(/\|\s*time_start\s*=\s*([^|\n]+)/i);
    const endTime = extract(/\|\s*time_end\s*=\s*([^|\n]+)/i);
    const resonator5F =
        extract(/\|\s*resonator_5_F\s*=\s*([^|\n]+)/i) ||
        extract(/\|\s*resonator_5_star\s*=\s*([^|\n]+)/i);
    const weapon5F =
        extract(/\|\s*weapon_5_F\s*=\s*([^|\n]+)/i) ||
        extract(/\|\s*weapon_5_star\s*=\s*([^|\n]+)/i);
    const isRerun = extract(/\|\s*rerun\s*=\s*([^|\n]+)/i) === "yes";

    // Extract Version (e.g. {{Change History|1.1}} or Version 1.1)
    const versionMatch =
        text.match(/\{\{Change History\|([\d.]+)/i) || text.match(/Version\s+([\d.]+)/i);
    const version = versionMatch ? versionMatch[1] : null;

    return { name, startTime, endTime, resonator5F, weapon5F, version, isRerun };
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

export async function updateWuwaBanners() {
    const { map: idMap, reverseMap: reverseIdMap } = await fetchWuwaMapping();
    console.log(`Loaded ${idMap.size} items from Encore.moe.`);

    const featuredCharPages = await fetchWikiPages("Category:Featured_Resonator_Convenes");
    const collabCharPages = await fetchWikiPages("Category:Collab_Resonator_Convenes");
    const charPages = [...featuredCharPages, ...collabCharPages];

    const featuredWeaponPages = await fetchWikiPages("Category:Featured_Weapon_Convenes");
    const collabWeaponPages = await fetchWikiPages("Category:Collab_Weapon_Convenes");
    const weaponPages = [...featuredWeaponPages, ...collabWeaponPages];

    const phasesMap = new Map<string, ProcessingPhase>();

    const processPage = (page: WikiPage, isChar: boolean) => {
        const content = page.revisions?.[0]?.slots?.main?.["*"];
        if (!content) return;

        const data = parseConveneTemplate(content);
        if (!data.startTime || !data.endTime) {
            console.log(`[DEBUG] Missing dates for page: ${page.title}`);
            return;
        }

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

        // Group by start time (allowing 24 hour tolerance to handle wiki date mismatches)
        let phaseKey = "";
        for (const [key] of Array.from(phasesMap.entries())) {
            const [kStart] = key.split("_").map(Number);
            if (Math.abs(kStart - startTimestamp) <= 24 * 3600 * 1000) {
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
                isNew: !data.isRerun,
            });
        }

        const phase = phasesMap.get(phaseKey)!;

        if (isChar && data.resonator5F) {
            const names = data.resonator5F.split(/[,;]/).map((n) => n.trim().toLowerCase());
            for (const name of names) {
                const id = idMap.get(name);
                if (id && !phase.featuredCharacters.includes(id)) {
                    phase.featuredCharacters.push(id);
                }
            }
        } else if (!isChar && data.weapon5F) {
            const names = data.weapon5F.split(/[,;]/).map((n) => n.trim().toLowerCase());
            for (const name of names) {
                const id = idMap.get(name);
                if (id && !phase.featuredWeapons.includes(id)) {
                    phase.featuredWeapons.push(id);
                    if (!phase.mainWeaponId) phase.mainWeaponId = id;
                }
            }
        }
    };

    console.log("Parsing wiki pages...");
    charPages.forEach((p) => processPage(p, true));
    weaponPages.forEach((p) => processPage(p, false));

    const sortedPhases = Array.from(phasesMap.values()).sort((a, b) => a.startTime - b.startTime);

    // Second pass: Track release history to identify reruns and main characters accurately
    const releasedCharacters = new Set<string>();

    // Finalize names and phase identifiers
    const versionGroups = new Map<string, ProcessingPhase[]>();

    for (const phase of sortedPhases) {
        // Identify truly new characters in this phase
        const newCharacters = phase.featuredCharacters.filter((id) => !releasedCharacters.has(id));

        if (newCharacters.length > 0) {
            // This is a release phase
            phase.isNew = true;
            phase.mainCharacterId = newCharacters[0];
            // Add all newly found characters to the released set
            for (const id of newCharacters) releasedCharacters.add(id);
        } else {
            // This is a rerun phase
            phase.isNew = false;
            // For reruns, we keep the first character as the main one if not already set
            if (!phase.mainCharacterId && phase.featuredCharacters.length > 0) {
                phase.mainCharacterId = phase.featuredCharacters[0];
            }
        }

        const v = phase.version || "Unknown";
        if (!versionGroups.has(v)) versionGroups.set(v, []);
        versionGroups.get(v)!.push(phase);
    }

    for (const [version, phases] of Array.from(versionGroups.entries())) {
        phases.sort((a, b) => a.startTime - b.startTime);
        phases.forEach((phase, index) => {
            phase.phase =
                version === "Unknown" ? `Phase_${phase.startTime}` : `${version}.${index + 1}`;

            const charNames = phase.featuredCharacters.map((id) => reverseIdMap.get(id) || id);
            const weaponNames = phase.featuredWeapons.map((id) => reverseIdMap.get(id) || id);

            if (charNames.length > 0) {
                phase.name = charNames.join(" / ");
            } else if (weaponNames.length > 0) {
                phase.name = weaponNames.join(" / ");
            }

            delete phase.version;
            delete phase.isNew;
            delete phase.metadata;
        });
    }

    console.log(`Generated ${sortedPhases.length} WuWa banner phases.`);

    const nextPhases = sortedPhases.filter(
        (p) => p.featuredCharacters.length > 0 || p.featuredWeapons.length > 0
    );

    let banners: BannersData = { games: { hsr: [], genshin: [], zzz: [], wuwa: [] } };
    if (fs.existsSync(BANNERS_PATH)) {
        try {
            banners = JSON.parse(fs.readFileSync(BANNERS_PATH, "utf-8"));
        } catch (error) {
            throw new Error(`Failed to parse banners.json: ${String(error)}`, { cause: error });
        }
    }

    const previousCount = banners.games.wuwa?.length || 0;
    if (nextPhases.length === 0 || (previousCount > 0 && nextPhases.length < previousCount)) {
        throw new Error(
            `Validation failed: scraped ${nextPhases.length} WuWa phases, but expected at least ${previousCount}. Aborting write to prevent data loss.`
        );
    }

    banners.games.wuwa = nextPhases;
    fs.writeFileSync(BANNERS_PATH, JSON.stringify(banners, null, 4));
    console.log("Successfully updated banners.json for WuWa");
}
