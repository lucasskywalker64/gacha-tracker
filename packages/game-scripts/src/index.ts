import { updateHsrBanners } from "./hsr/index.js";

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
    } else {
        console.error(`Error: Unknown game: ${game}`);
        process.exit(1);
    }
}

main().catch(console.error);
