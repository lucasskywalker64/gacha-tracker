import type { GameAdapter } from "@gacha-tracker/shared";
import { hsrAdapter } from "./hsr";
import { genshinAdapter } from "./genshin";
import { zzzAdapter } from "./zzz";
import { wuwaAdapter } from "./wuwa";

// ---------------------------------------------------------------------------
// Game Plugin Registry
// ---------------------------------------------------------------------------

const registry = new Map<string, GameAdapter>();

export function registerAdapter(adapter: GameAdapter) {
    registry.set(adapter.gameId, adapter);
}

export function getAdapter(gameId: string): GameAdapter {
    const adapter = registry.get(gameId);
    if (!adapter) {
        throw new Error(`Game adapter not found for gameId: ${gameId}`);
    }
    return adapter;
}

export function getAllAdapters(): GameAdapter[] {
    return Array.from(registry.values());
}

// ---------------------------------------------------------------------------
// Auto-register built-in adapters
// ---------------------------------------------------------------------------

registerAdapter(hsrAdapter);
registerAdapter(genshinAdapter);
registerAdapter(zzzAdapter);
registerAdapter(wuwaAdapter);
