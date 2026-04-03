import { Elysia } from "elysia";
import { auth } from "../modules/auth/auth";

/**
 * authGuard
 *
 * Validates Better-Auth session cookie on every request in the guarded group.
 * On success, attaches `user` and `session` to the request context.
 * On failure, returns 401 Unauthorized.
 *
 * Soft-deleted users (deletedAt is set) are rejected with 401.
 *
 * Usage:
 *   app.guard({ beforeHandle: authGuard }, app => app.use(somePlugin))
 *
 * Or with the macro pattern (preferred for individual routes):
 *   app.get('/route', handler, { auth: true })
 */
export const authGuard = new Elysia({ name: "auth-guard" }).derive(
  { as: "scoped" },
  async ({ request: { headers }, set }) => {
    const session = await auth.api.getSession({ headers });

    if (!session) {
      set.status = 401;
      throw new Error("Unauthorized");
    }

    const user = session.user as typeof session.user & {
      deletedAt: number | null;
      isAnonymous: boolean;
      isAdmin: boolean;
    };

    if (user.deletedAt !== null && user.deletedAt !== undefined) {
      set.status = 401;
      throw new Error("Unauthorized: account deleted");
    }

    return { user, session: session.session };
  },
);

export type AuthenticatedUser = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string | null | undefined;
  deletedAt: number | null;
  isAnonymous: boolean;
  isAdmin: boolean;
};
