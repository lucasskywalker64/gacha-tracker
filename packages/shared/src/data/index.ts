import bannersData from "./banners.json";

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
        [gameId: string]: BannerPhase[];
    };
}

export const banners = bannersData as BannersData;
