import bannersData from "./banners.json";
import srgfDictData from "./srgf_dict.json";
import uigfDictData from "./uigf_dict.json";

export interface BannerPhase {
    phase: string;
    name: string;
    featuredCharacters: string[];
    mainCharacterId: string;
    featuredWeapons: string[];
    mainWeaponId: string;
    startTime: number;
    endTime: number | null;
}

export interface BannersData {
    games: {
        hsr: BannerPhase[];
        genshin: BannerPhase[];
        zzz: BannerPhase[];
        wuwa: BannerPhase[];
        [gameId: string]: BannerPhase[];
    };
}

export const banners = bannersData as BannersData;

export interface SrgfDictEntry {
    name: string;
    rarity: number;
    type: string;
}

export type SrgfDict = Record<string, SrgfDictEntry>;

export const srgfDict = srgfDictData as SrgfDict;

export interface UigfDictEntry {
    id: string;
    rarity: number;
    type: string;
}

export type UigfDict = Record<string, UigfDictEntry>;

/** Keyed by lowercase item name (e.g. "diona", "dull blade") */
export const uigfDict = uigfDictData as UigfDict;
