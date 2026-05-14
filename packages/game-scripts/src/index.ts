import { updateHsrBanners } from "./hsr/index.js";
import { updateGenshinBanners } from "./genshin/index.js";
import { updateZzzBanners } from "./zzz/index.js";
import { updateWuwaBanners } from "./wuwa/index.js";

async function main() {
    const args = process.argv.slice(2);
    const game = args.find((a) => a.startsWith("--game="))?.split("=")[1];

    if (!game) {
        console.error("Error: Please specify a game using --game=<game> (e.g., --game=hsr)");
        process.exit(1);
    }

    const updaters: Record<string, { name: string; update: () => Promise<void> }> = {
        hsr: { name: "Honkai: Star Rail", update: updateHsrBanners },
        genshin: { name: "Genshin Impact", update: updateGenshinBanners },
        zzz: { name: "Zenless Zone Zero", update: updateZzzBanners },
        wuwa: { name: "Wuthering Waves", update: updateWuwaBanners },
    };

    const config = updaters[game];

    if (config) {
        console.log(`Updating ${config.name} banners...`);
        await config.update();
    } else {
        console.error(`Error: Unknown game: ${game}`);
        process.exit(1);
    }
}

main().catch(console.error);
