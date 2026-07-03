import type { ImportParser } from "./types";
import { GachaTrackerJsonParser } from "./gacha-tracker-json";

const parsers: Record<string, ImportParser> = {
    "gacha-tracker-json": new GachaTrackerJsonParser(),
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
