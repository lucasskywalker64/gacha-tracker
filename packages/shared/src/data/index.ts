import bannersData from "./banners.json";
import srgfDictData from "./srgf_dict.json";

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
