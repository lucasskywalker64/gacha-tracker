import { describe, it, expect } from "bun:test";
import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { securityHeaders } from "../securityHeaders";

describe("Security Middleware", () => {
    describe("securityHeaders", () => {
        it("injects all expected secure headers on a standard request", async () => {
            const app = new Elysia().use(securityHeaders).get("/test", () => "ok");

            const res = await app.handle(new Request("http://localhost/test"));
            expect(res.status).toBe(200);

            expect(res.headers.get("Content-Security-Policy")).toBe(
                "default-src 'none'; frame-ancestors 'none'; sandbox;"
            );
            expect(res.headers.get("X-Frame-Options")).toBe("DENY");
            expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
            expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
        });
    });

    describe("CORS Restrictions", () => {
        // Build a simulated CORS configuration representing our index.ts behavior
        const buildCorsApp = (isProduction: boolean, frontendUrl: string) => {
            const allowedOrigins = ["https://gacha-tracker.app", "https://dev.gacha-tracker.app"];
            if (!isProduction) {
                try {
                    allowedOrigins.push(new URL(frontendUrl).origin);
                } catch {
                    allowedOrigins.push("http://localhost:5173");
                }
            }

            return new Elysia()
                .use(
                    cors({
                        origin: allowedOrigins,
                        credentials: true,
                    })
                )
                .get("/test", () => "ok");
        };

        it("allows only gacha-tracker.app and dev.gacha-tracker.app in production mode", async () => {
            const app = buildCorsApp(true, "http://localhost:5173");

            // 1. Disallowed origin (e.g. localhost or malicious.com)
            const resDisallowed = await app.handle(
                new Request("http://localhost/test", {
                    method: "OPTIONS",
                    headers: {
                        Origin: "http://malicious.com",
                        "Access-Control-Request-Method": "GET",
                    },
                })
            );
            expect(resDisallowed.headers.get("Access-Control-Allow-Origin")).toBeNull();

            // 2. Allowed production bare domain origin
            const resProduction = await app.handle(
                new Request("http://localhost/test", {
                    method: "OPTIONS",
                    headers: {
                        Origin: "https://gacha-tracker.app",
                        "Access-Control-Request-Method": "GET",
                    },
                })
            );
            expect(resProduction.headers.get("Access-Control-Allow-Origin")).toBe(
                "https://gacha-tracker.app"
            );

            // 3. Allowed dev staging subdomain origin
            const resDevStaging = await app.handle(
                new Request("http://localhost/test", {
                    method: "OPTIONS",
                    headers: {
                        Origin: "https://dev.gacha-tracker.app",
                        "Access-Control-Request-Method": "GET",
                    },
                })
            );
            expect(resDevStaging.headers.get("Access-Control-Allow-Origin")).toBe(
                "https://dev.gacha-tracker.app"
            );
        });

        it("allows configured local FRONTEND_URL dynamically in non-production mode", async () => {
            const app = buildCorsApp(false, "http://localhost:5173");

            // 1. Allowed local dev origin
            const resLocal = await app.handle(
                new Request("http://localhost/test", {
                    method: "OPTIONS",
                    headers: {
                        Origin: "http://localhost:5173",
                        "Access-Control-Request-Method": "GET",
                    },
                })
            );
            expect(resLocal.headers.get("Access-Control-Allow-Origin")).toBe(
                "http://localhost:5173"
            );

            // 2. Disallowed origin
            const resDisallowed = await app.handle(
                new Request("http://localhost/test", {
                    method: "OPTIONS",
                    headers: {
                        Origin: "http://evil-localhost:5173",
                        "Access-Control-Request-Method": "GET",
                    },
                })
            );
            expect(resDisallowed.headers.get("Access-Control-Allow-Origin")).toBeNull();
        });
    });
});
