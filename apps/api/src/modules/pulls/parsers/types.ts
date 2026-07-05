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

export interface ImportParser {
    formatId: string;
    displayName: string;
    acceptedExtensions: string;
    parse(buffer: Buffer): Promise<ParsedImportResult>;
}
