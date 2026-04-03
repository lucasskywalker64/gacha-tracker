import { Elysia } from "elysia";
import { auth } from "./auth";
import { anonymousAuthPlugin } from "./anonymous";

/**
 * Auth Elysia plugin.
 *
 * - Mounts Better-Auth's handler at /api/auth/* via `.mount()`.
 * - Provides a `.macro` for route-level session enforcement that other plugins
 *   can use by passing `{ auth: true }` to a route definition.
 * - Includes the anonymous auth endpoints from anonymousAuthPlugin.
 */
export const authPlugin = new Elysia({ name: "auth" })
  .use(anonymousAuthPlugin)
  .mount(auth.handler)
  .macro({
    auth: {
      async resolve({ status, request: { headers } }) {
        const session = await auth.api.getSession({ headers });
        if (!session) return status(401);
        return {
          user: session.user,
          session: session.session,
        };
      },
    },
  });

export { auth };
export type { Auth } from "./auth";
