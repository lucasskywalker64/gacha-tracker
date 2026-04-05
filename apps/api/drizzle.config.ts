import { defineConfig } from "drizzle-kit";

const url = process.env["DATABASE_URL"];
const authToken = process.env["DATABASE_AUTH_TOKEN"];

if (!url) throw new Error("DATABASE_URL is required for drizzle-kit");

export default defineConfig({
    schema: "./src/db/schema/*",
    out: "./src/db/migrations",
    dialect: "turso",
    dbCredentials: {
        url,
        authToken,
    },
    strict: true,
    verbose: true,
});
