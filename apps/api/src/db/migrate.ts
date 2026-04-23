import { migrate } from "drizzle-orm/libsql/migrator";
import { db } from "./client";
import path from "node:path";

/**
 * Runs pending database migrations from the migrations folder.
 *
 * This ensures the database schema is up-to-date with the code before
 * the application starts accepting requests.
 */
export async function runMigrations() {
    console.log("⏳ Running migrations...");

    try {
        const migrationsFolder = path.resolve(import.meta.dir, "migrations");

        await migrate(db, {
            migrationsFolder,
        });

        console.log("✅ Migrations completed");
    } catch (error) {
        console.error("❌ Migrations failed:", error);
        process.exit(1);
    }
}
