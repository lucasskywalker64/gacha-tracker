import type { ImportParser } from "./types";
import { GachaTrackerJsonParser } from "./gacha-tracker-json";
import { WuWaTrackerJsonParser } from "./wuwa-tracker-json";
import { StarRailStationParser } from "./starrail-station";

const parsers: Record<string, ImportParser> = {
    "gacha-tracker-json": new GachaTrackerJsonParser(),
    "wuwa-tracker-json": new WuWaTrackerJsonParser(),
    "starrail-station": new StarRailStationParser(),
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
