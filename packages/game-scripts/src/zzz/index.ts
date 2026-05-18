import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as cheerio from "cheerio";
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

async function fetchCharacterIDs() {
    const map = new Map<string, string>();
    const reverseMap = new Map<string, string>();

    const url =
        "https://raw.githubusercontent.com/donutman07/Zenless-Zone-Zero-ZZZ-Character-IDs/main/ZZZCharacterIDs.md";
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        const text = await res.text();

        const lines = text.split("\n");
        for (const line of lines) {
            if (!line.includes("|")) continue;
            if (line.includes("ID") && line.includes("NAME")) continue;
            if (line.includes("--")) continue;

            const parts = line.split("|").map((p) => p.trim());
            if (parts.length >= 4) {
                const id = parts[1];
                let name = parts[2];
                const codename = parts[3];

                // Formatting fixes for names
                if (name === "Lucia (Old)") continue; // Skip duplicate ID
                if (name === "SS - Anby") name = "Soldier 0 - Anby";

                if (id && name && !isNaN(parseInt(id))) {
                    map.set(name.toLowerCase(), id);

                    // Add codenames as aliases
                    if (codename) {
                        const aliases = codename
                            .toLowerCase()
                            .split(",")
                            .map((a) => a.trim());
                        for (const alias of aliases) {
                            if (alias && !map.has(alias)) {
                                map.set(alias, id);
                            }
                        }
                    }

                    reverseMap.set(id, name);
                }
            }
        }
    } catch (error) {
        console.error(`Failed to fetch community mapping for ZZZ:`, error);
    }

    const wUrl =
        "https://zenless-zone-zero.fandom.com/api.php?action=query&generator=categorymembers&gcmtitle=Category:S-Rank_W-Engines&gcmlimit=50&prop=revisions&rvprop=content&rvslots=main&format=json";
    try {
        const wRes = await fetch(wUrl);
        if (wRes.ok) {
            const wData = await wRes.json();
            if (wData.query && wData.query.pages) {
                for (const key in wData.query.pages) {
                    const page = wData.query.pages[key];
                    const content = page.revisions?.[0]?.slots?.main?.["*"];
                    if (content) {
                        const nameMatch = content.match(/\|\s*name\s*=\s*([^\n\r]*)/);
                        const idMatch = content.match(/\|\s*id\s*=\s*([^\n\r]*)/);
                        if (nameMatch && idMatch) {
                            const wName = nameMatch[1].trim();
                            const wId = idMatch[1].trim();
                            if (wName && wId && !isNaN(parseInt(wId))) {
                                map.set(wName.toLowerCase(), wId);
                                reverseMap.set(wId, wName);
                                const first = wName.split(" ")[0].toLowerCase();
                                if (!map.has(first)) map.set(first, wId);
                            }
                        }
                    }
                }
            }
        }
    } catch (e) {
        console.error("Failed to fetch W-Engine IDs from Wiki:", e);
    }

    const ZZZ_LOCAL_OVERRIDES: Record<string, string> = {
        // Full-name aliases for characters (matches Wiki titles to Repo short names)
        "1191": "Ellen Joe",
        "1261": "Jane Doe",
        "1071": "Caesar King",
        "1171": "Burnice White",
        "1221": "Tsukishiro Yanagi",
        "1091": "Hoshimi Miyabi",
        "1201": "Asaba Harumasa",
        "1321": "Evelyn Chevalier",
        "1331": "Vivian Banshee",
        "1401": "Alice Thymefield",
        "1411": "Ukinami Yuzuha",
        "1431": "Ye Shunguang",
        "1451": "Lucia Elowen",
        "1051": "Yidhari Murphy",
        "1301": "Orphie Magnusson and Magus",
        "1291": "Hugo Vlad",
        "1271": "Seth Lowell",
        "1281": "Piper Wheel",
        "1381": "Soldier 0 - Anby",
    };

    for (const [id, name] of Object.entries(ZZZ_LOCAL_OVERRIDES)) {
        const strId = id;
        const cleanName = name.toLowerCase();
        map.set(cleanName, strId);
        if (!reverseMap.has(strId)) reverseMap.set(strId, name);
    }

    return { map, reverseMap };
}

function findItemId(
    name: string,
    idMap: Map<string, string>,
    reverseIdMap?: Map<string, string>
): string | undefined {
    const n = name.trim().toLowerCase();
    if (idMap.has(n)) return idMap.get(n);

    // Try cleaning name common prefixes (e.g. "W-Engine Steel Cushion" -> "Steel Cushion")
    const clean = n
        .replace(/^w-engine\s+/i, "")
        .replace(/^bangboo\s+/i, "")
        .replace(/\[|\]/g, "");
    if (idMap.has(clean)) return idMap.get(clean);

    // Generate placeholder ID for unmapped items
    const firstWord = clean.split(" ")[0];
    const capitalized = firstWord.charAt(0).toUpperCase() + firstWord.slice(1).toLowerCase();
    const placeholderId = "placeholder_" + capitalized;

    console.warn(`Assigned placeholder ID ${placeholderId} for missing item: ${name}`);
    idMap.set(n, placeholderId);
    if (reverseIdMap && !reverseIdMap.has(placeholderId)) {
        reverseIdMap.set(placeholderId, name.trim());
    }
    return placeholderId;
}

async function fetchWikiPages(category: string) {
    const pages: WikiPage[] = [];
    let url = `https://zenless-zone-zero.fandom.com/api.php?action=query&generator=categorymembers&gcmtitle=${category}&gcmlimit=50&prop=revisions&rvprop=content&rvslots=main&format=json`;
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
                url = `https://zenless-zone-zero.fandom.com/api.php?action=query&generator=categorymembers&gcmtitle=${category}&gcmlimit=50&prop=revisions&rvprop=content&rvslots=main&format=json&gcmcontinue=${encodeURIComponent(data.continue.gcmcontinue)}`;
            } else {
                hasMore = false;
            }
        }
    } catch (error) {
        console.error(`Failed to fetch wiki pages for ${category}:`, error);
    }
    return pages;
}

async function fetchWikiPageHTML(pageName: string) {
    const url = `https://zenless-zone-zero.fandom.com/api.php?action=parse&page=${encodeURIComponent(pageName)}&prop=text&format=json`;
    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        const data = await res.json();
        if (!data.parse || !data.parse.text) return "";
        return data.parse.text["*"];
    } catch (error) {
        console.error(`Failed to fetch wiki page HTML for ${pageName}:`, error);
        return "";
    }
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

function parseSignalSearchTemplate(
    text: string,
    idMap: Map<string, string>,
    reverseIdMap: Map<string, string>
) {
    const extract = (regex: RegExp) => {
        const match = text.match(regex);
        return match ? match[1].trim() : null;
    };

    const name = extract(/\|\s*name\s*=\s*([^|\n]+)/i);
    const startTimeStr = extract(/\|\s*time_start\s*=\s*([^|\n]+)/i);
    const endTimeStr = extract(/\|\s*time_end\s*=\s*([^|\n]+)/i);
    const agentSF = extract(/\|\s*agent_S_F\s*=\s*([^|\n]+)/i);

    const versionMatch = text.match(/\{\{Change History\|([^}|]+)/i);
    const version = versionMatch ? versionMatch[1].replace("Version ", "").trim() : "1.0";

    const startTime = parseDate(startTimeStr || "");
    const endTime = parseDate(endTimeStr || "");

    if (!startTime) {
        console.log(
            `[DEBUG] Failed to parse startTime: "${startTimeStr}" for exclusive channel banner: ${name}`
        );
        return null;
    }

    if (!endTime) {
        console.log(
            `[DEBUG] Failed to parse endTime: "${endTimeStr}" for exclusive channel banner: ${name}`
        );
        return null;
    }

    const featuredCharacters: string[] = [];
    if (agentSF) {
        agentSF.split(";").forEach((n) => {
            const id = findItemId(n, idMap, reverseIdMap);
            if (id) {
                featuredCharacters.push(id);
            } else {
                console.log(`Failed to match agent: ${n}`);
            }
        });
    }

    if (featuredCharacters.length === 0) {
        console.log(`No featured characters found for banner ${name}`);
        return null;
    }

    const characterIds = Array.from(new Set(featuredCharacters));
    const mainCharacterId = characterIds[0] || "";
    const bannerName = characterIds.map((id) => reverseIdMap.get(id)).join(" / ");

    return {
        phase: version,
        name: name || bannerName,
        featuredCharacters: characterIds,
        mainCharacterId,
        featuredWeapons: [],
        mainWeaponId: "",
        startTime,
        endTime,
    } as BannerPhase;
}

export async function updateZzzBanners() {
    const { map: idMap, reverseMap: reverseIdMap } = await fetchCharacterIDs();
    console.log(`Loaded ${idMap.size} items from community ID mapping.`);

    const phases: BannerPhase[] = [];

    // 1. Agents (Exclusive Channels)
    console.log("Fetching Agent Exclusive Channels...");
    const categories = [
        "Category:Exclusive_Channel_Signal_Searches",
        "Category:Agent_Exclusive_Channel_Signal_Searches",
    ];
    for (const cat of categories) {
        const agentPages = await fetchWikiPages(cat);
        for (const page of agentPages) {
            const content = page.revisions?.[0]?.slots?.main?.["*"];
            if (!content) continue;

            const data = parseSignalSearchTemplate(content, idMap, reverseIdMap);
            if (data) {
                phases.push(data);
            }
        }
    }

    // 2. W-Engines
    console.log("Fetching W-Engine Channel History...");
    const wEngineHTML = await fetchWikiPageHTML("W-Engine_Channel/History");
    if (wEngineHTML) {
        const $ = cheerio.load(wEngineHTML);
        $("table.article-table tr").each((i, el) => {
            if (i === 0) return;
            const tds = $(el).find("td");
            if (tds.length < 5) return;

            const name = $(tds[0]).find("a").first().text().trim();
            // Skip standard banners
            if (name === "W-Engine Reverberation") return;

            const startStr = $(tds[2]).attr("data-sort-value") || $(tds[2]).text().trim();
            const endStr = $(tds[3]).attr("data-sort-value") || $(tds[3]).text().trim();
            const version = $(tds[4]).text().trim().replace("Version ", "").trim();

            const start = parseDate(startStr);
            const end = parseDate(endStr);

            if (!start) {
                console.log(
                    `[DEBUG] Failed to parse startTime: "${startStr}" for W-Engine banner: ${name}`
                );
                return;
            }

            if (!end) {
                console.log(
                    `[DEBUG] Failed to parse endTime: "${endStr}" for W-Engine banner: ${name}`
                );
                return;
            }

            const featuredWeapons: string[] = [];
            $(tds[1])
                .find(".card-rank-S a")
                .each((_, a) => {
                    const wName = $(a).attr("title")?.trim();
                    if (wName) {
                        const id = findItemId(wName, idMap, reverseIdMap);
                        if (id) featuredWeapons.push(id);
                    }
                });

            if (featuredWeapons.length > 0) {
                const weaponIds = Array.from(new Set(featuredWeapons));
                phases.push({
                    phase: version,
                    name,
                    featuredCharacters: [],
                    mainCharacterId: "",
                    featuredWeapons: weaponIds,
                    mainWeaponId: weaponIds[0],
                    startTime: start,
                    endTime: end,
                });
            }
        });
    }

    // 3. Bangboos
    console.log("Fetching Bangboo Channel History...");
    const bangbooHTML = await fetchWikiPageHTML("Bangboo_Channel");
    if (bangbooHTML) {
        const $ = cheerio.load(bangbooHTML);
        $("table.article-table tr").each((i, el) => {
            if (i === 0) return;
            const tds = $(el).find("td");
            if (tds.length < 5) return;

            const name = $(tds[0]).find("a").first().text().trim();
            // Skip standard banners
            if (name === "Mellow Waveride") return;

            const startStr = $(tds[2]).attr("data-sort-value") || $(tds[2]).text().trim();
            const endStr = $(tds[3]).attr("data-sort-value") || $(tds[3]).text().trim();
            const version = $(tds[4]).text().trim().replace("Version ", "").trim();

            const start = parseDate(startStr);
            const end = parseDate(endStr);

            if (!start) {
                console.log(
                    `[DEBUG] Failed to parse startTime: "${startStr}" for Bangboo banner: ${name}`
                );
                return;
            }

            if (!end) {
                console.log(
                    `[DEBUG] Failed to parse endTime: "${endStr}" for Bangboo banner: ${name}`
                );
                return;
            }

            const featuredBangboos: string[] = [];
            $(tds[1])
                .find("a")
                .each((_, a) => {
                    const bName = $(a).attr("title")?.trim();
                    if (bName) {
                        const id = findItemId(bName, idMap, reverseIdMap);
                        if (id) featuredBangboos.push(id);
                    }
                });

            if (featuredBangboos.length > 0) {
                const bangbooIds = Array.from(new Set(featuredBangboos));
                phases.push({
                    phase: version,
                    name,
                    featuredCharacters: bangbooIds,
                    mainCharacterId: bangbooIds[0],
                    featuredWeapons: [],
                    mainWeaponId: "",
                    startTime: start,
                    endTime: end,
                });
            }
        });
    }

    // Post-process: Sort and merge
    const sortedPhases = phases.sort((a, b) => a.startTime - b.startTime);
    const mergedPhases: BannerPhase[] = [];

    const firstAppearanceChar = new Map<string, number>();
    const firstAppearanceWeap = new Map<string, number>();
    for (const p of sortedPhases) {
        if (p.phase === "Standard") continue;
        if (p.mainCharacterId && !firstAppearanceChar.has(p.mainCharacterId)) {
            firstAppearanceChar.set(p.mainCharacterId, p.startTime);
        }
        if (p.mainWeaponId && !firstAppearanceWeap.has(p.mainWeaponId)) {
            firstAppearanceWeap.set(p.mainWeaponId, p.startTime);
        }
    }

    for (const p of sortedPhases) {
        // Merge if within 12 hours
        const existing = mergedPhases.find(
            (m) => m.phase !== "Standard" && Math.abs(m.startTime - p.startTime) < 43200000
        );

        if (existing) {
            existing.featuredCharacters = Array.from(
                new Set([...existing.featuredCharacters, ...p.featuredCharacters])
            );
            existing.featuredWeapons = Array.from(
                new Set([...existing.featuredWeapons, ...p.featuredWeapons])
            );

            const pCharIsNew = !!(
                p.mainCharacterId && firstAppearanceChar.get(p.mainCharacterId) === p.startTime
            );
            const existingCharIsNew = !!(
                existing.mainCharacterId &&
                firstAppearanceChar.get(existing.mainCharacterId) === existing.startTime
            );

            if (p.mainCharacterId) {
                if (pCharIsNew && !existingCharIsNew) {
                    existing.mainCharacterId = p.mainCharacterId;
                } else if (pCharIsNew === existingCharIsNew) {
                    if (
                        !existing.mainCharacterId ||
                        parseInt(p.mainCharacterId) > (parseInt(existing.mainCharacterId) || 0)
                    ) {
                        existing.mainCharacterId = p.mainCharacterId;
                    }
                }
            }

            const pWeapIsNew = !!(
                p.mainWeaponId && firstAppearanceWeap.get(p.mainWeaponId) === p.startTime
            );
            const existingWeapIsNew = !!(
                existing.mainWeaponId &&
                firstAppearanceWeap.get(existing.mainWeaponId) === existing.startTime
            );

            if (p.mainWeaponId) {
                if (pWeapIsNew && !existingWeapIsNew) {
                    existing.mainWeaponId = p.mainWeaponId;
                } else if (pWeapIsNew === existingWeapIsNew) {
                    if (
                        !existing.mainWeaponId ||
                        parseInt(p.mainWeaponId) > (parseInt(existing.mainWeaponId) || 0)
                    ) {
                        existing.mainWeaponId = p.mainWeaponId;
                    }
                }
            }

            // Name priority: All S-Ranks in the phase
            if (existing.featuredCharacters.length > 0) {
                existing.name = existing.featuredCharacters
                    .map((id) => reverseIdMap.get(id))
                    .join(" / ");
            }
        } else {
            mergedPhases.push(p);
        }
    }

    // Assign final phase names (e.g. 1.0.1, 1.0.2)
    const versionCounts = new Map<string, number>();
    for (const p of mergedPhases) {
        const version = p.phase;
        const count = (versionCounts.get(version) || 0) + 1;
        versionCounts.set(version, count);
        p.phase = `${version}.${count}`;
    }

    console.log(`Generated ${mergedPhases.length} ZZZ banner phases.`);

    let banners: BannersData = { games: { hsr: [], genshin: [], zzz: [], wuwa: [] } };
    if (fs.existsSync(BANNERS_PATH)) {
        try {
            banners = JSON.parse(fs.readFileSync(BANNERS_PATH, "utf-8"));
        } catch (error) {
            throw new Error(`Failed to parse banners.json: ${String(error)}`, { cause: error });
        }
    }

    const previousCount = banners.games.zzz?.length || 0;
    if (mergedPhases.length === 0 || (previousCount > 0 && mergedPhases.length < previousCount)) {
        throw new Error(
            `Validation failed: scraped ${mergedPhases.length} ZZZ phases, but expected at least ${previousCount}. Aborting write to prevent data loss.`
        );
    }

    banners.games.zzz = mergedPhases;
    fs.writeFileSync(BANNERS_PATH, JSON.stringify(banners, null, 4));
    console.log("Successfully updated banners.json for ZZZ");
}
