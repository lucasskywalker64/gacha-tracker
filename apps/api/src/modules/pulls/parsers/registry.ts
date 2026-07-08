import type { ImportParser } from "./types";
import { GachaTrackerParser } from "./gacha-tracker";
import { WuWaTrackerJsonParser } from "./wuwa-tracker";
import { StarRailStationParser } from "./starrail-station";
import { PaimonMoeParser } from "./paimon-moe";

const parsers: Record<string, ImportParser> = {
    "gacha-tracker": new GachaTrackerParser(),
    "wuwa-tracker": new WuWaTrackerJsonParser(),
    "starrail-station": new StarRailStationParser(),
    "paimon-moe": new PaimonMoeParser(),
};

export function getParser(formatId: string): ImportParser {
    const parser = parsers[formatId];
    if (!parser) {
        throw new Error(`Unsupported import format: ${formatId}`);
    }
    return parser;
}

export function getSupportedFormats() {
    return Object.values(parsers).map((p) => ({
        id: p.formatId,
        displayName: p.displayName,
        acceptedExtensions: p.acceptedExtensions,
    }));
}
export type SupportedFormat = ReturnType<typeof getSupportedFormats>[number];
