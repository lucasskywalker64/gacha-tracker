import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { updateHsrBanners } from "./hsr/index.js";
import { updateGenshinBanners } from "./genshin/index.js";
import { updateZzzBanners } from "./zzz/index.js";
import { updateWuwaBanners } from "./wuwa/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BANNERS_PATH = path.resolve(__dirname, "../../shared/src/data/banners.json");

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
        console.log("Formatting banners.json...");
        try {
            execSync(`npx prettier --write "${BANNERS_PATH}"`, { stdio: "inherit" });
        } catch (error) {
            console.error("Failed to format banners.json:", error);
        }
    } else {
        console.error(`Error: Unknown game: ${game}`);
        process.exit(1);
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
