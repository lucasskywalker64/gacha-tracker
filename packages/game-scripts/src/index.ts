import { updateHsrBanners } from "./hsr/index.js";
import { updateGenshinBanners } from "./genshin/index.js";
import { updateZzzBanners } from "./zzz/index.js";

async function main() {
    const args = process.argv.slice(2);
    const game = args.find((a) => a.startsWith("--game="))?.split("=")[1];

    if (!game) {
        console.error("Error: Please specify a game using --game=<game> (e.g., --game=hsr)");
        process.exit(1);
    }

    if (game === "hsr") {
        console.log("Updating Honkai: Star Rail banners...");
        await updateHsrBanners();
    } else if (game === "genshin") {
        console.log("Updating Genshin Impact banners...");
        await updateGenshinBanners();
    } else if (game === "zzz") {
        console.log("Updating Zenless Zone Zero banners...");
        await updateZzzBanners();
    } else {
        console.error(`Error: Unknown game: ${game}`);
        process.exit(1);
    }
}

main().catch(console.error);
