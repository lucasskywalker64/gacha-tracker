import { Elysia } from "elysia";

/**
 * securityHeaders
 *
 * Global middleware that appends robust HTTP security headers to every response.
 * Defends the API against XSS, MIME sniffing, framing/clickjacking, and information leakage.
 */
export const securityHeaders = new Elysia({ name: "security-headers" }).onRequest(({ set }) => {
    set.headers["Content-Security-Policy"] = "default-src 'none'; frame-ancestors 'none'; sandbox;";
    set.headers["X-Frame-Options"] = "DENY";
    set.headers["X-Content-Type-Options"] = "nosniff";
    set.headers["Referrer-Policy"] = "no-referrer";
});
