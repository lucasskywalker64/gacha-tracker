export interface ParsedPull {
    pullId: string;
    bannerType: string;
    bannerId?: string | null;
    itemId: string;
    itemName: string;
    itemType: string;
    rarity: number;
    pulledAt: Date;
}

export interface ParsedGamePulls {
    gameId: string;
    gameUid: string;
    nickname?: string | null;
    pulls: ParsedPull[];
}

export interface ParsedImportResult {
    games: ParsedGamePulls[];
}

/** Optional caller-supplied metadata forwarded to the parser (e.g. a UID the file doesn't contain, or multi-profile mappings). */
export interface ParseContext {
    gameUid?: string;
    profileUids?: Record<string, string>;
}

export interface ImportParser {
    formatId: string;
    displayName: string;
    acceptedExtensions: string;
    parse(buffer: Buffer, context?: ParseContext): Promise<ParsedImportResult>;
}
