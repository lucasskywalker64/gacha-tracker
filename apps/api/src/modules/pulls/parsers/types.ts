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
    pulls: ParsedPull[];
}

export interface ParsedImportResult {
    games: ParsedGamePulls[];
}

/** Optional caller-supplied metadata forwarded to the parser (e.g. a UID the file doesn't contain). */
export interface ParseContext {
    gameUid?: string;
}

export interface ImportParser {
    formatId: string;
    displayName: string;
    acceptedExtensions: string;
    parse(buffer: Buffer, context?: ParseContext): Promise<ParsedImportResult>;
}
