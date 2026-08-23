import { Elysia, t } from "elysia";
import { db } from "../../db/client";
import { user, pull, userGame, userEmails } from "../../db/schema";
import { eq, and } from "drizzle-orm";
import { authPlugin, auth, getUserAuthMethodsCount } from "../auth";
import { sendOtpEmail } from "../../lib/email";
import { redis } from "../../lib/redis";
import { RedisKeys } from "../../lib/redis-keys";
import { checkRateLimit } from "../../lib/rateLimit";
import { randomInt } from "node:crypto";

export const userRouter = new Elysia({ prefix: "/user" })
    .use(authPlugin)

    .guard({ auth: true }) // Enforce authentication for all sub-routes

    // GET /user/settings - Retrieve preferences from session (0 DB reads)
    .get("/settings", async ({ user: sessionUser }) => {
        return {
            userId: sessionUser!.id,
            theme: sessionUser!.theme ?? "system",
            pityDisplayMode: sessionUser!.pityDisplayMode ?? "count_up",
            updatedAt: sessionUser!.updatedAt ?? new Date(),
        };
    })

    // PATCH /user/settings - Update specific settings on user table
    .patch(
        "/settings",
        async ({ user: sessionUser, session: currentSession, body }) => {
            const userId = sessionUser!.id;

            await db
                .update(user)
                .set({
                    ...(body.theme !== undefined ? { theme: body.theme } : {}),
                    ...(body.pityDisplayMode !== undefined
                        ? { pityDisplayMode: body.pityDisplayMode }
                        : {}),
                    updatedAt: new Date(),
                })
                .where(eq(user.id, userId));

            if (currentSession?.token) {
                await redis.del(currentSession.token);
            }

            return { success: true };
        },
        {
            body: t.Object({
                theme: t.Optional(
                    t.Union([
                        t.Literal("system"),
                        t.Literal("quantum-dark"),
                        t.Literal("amber-dawn"),
                        t.Literal("wobbly-waves"),
                    ])
                ),
                pityDisplayMode: t.Optional(
                    t.Union([t.Literal("count_up"), t.Literal("count_down")])
                ),
            }),
        }
    )

    // GET /user/export - Aggregate and return all user pulls & metadata
    .get("/export", async ({ user: sessionUser }) => {
        const userId = sessionUser!.id;

        const [pulls, games] = await Promise.all([
            db.select().from(pull).where(eq(pull.userId, userId)),
            db.select().from(userGame).where(eq(userGame.userId, userId)),
        ]);

        return {
            exportedAt: new Date().toISOString(),
            schemaVersion: "1.0.0",
            userId,
            games,
            pulls,
        };
    })

    // DELETE /user/game/:gameId - Reset/Purge history for a single game
    .delete(
        "/game/:gameId",
        async ({ user: sessionUser, params: { gameId }, body, status }) => {
            const userId = sessionUser!.id;

            const userRecord = await db.query.user.findFirst({
                where: eq(user.id, userId),
            });
            if (!userRecord) {
                return status(404, {
                    success: false,
                    error: { code: "USER_NOT_FOUND", message: "User not found" },
                });
            }

            const isAnonymous = userRecord.email.endsWith("@anon.gacha-tracker.app");

            if (isAnonymous) {
                if (!userRecord.codeHash) {
                    return status(400, {
                        success: false,
                        error: {
                            code: "NOT_ANONYMOUS_ACCOUNT",
                            message:
                                "This verification method is only available for anonymous accounts.",
                        },
                    });
                }
                if (!body?.code) {
                    return status(400, {
                        success: false,
                        error: {
                            code: "CODE_REQUIRED",
                            message: "Account code is required to purge game data.",
                        },
                    });
                }
                const isValid = await Bun.password.verify(body.code, userRecord.codeHash);
                if (!isValid) {
                    return status(400, {
                        success: false,
                        error: {
                            code: "INVALID_CODE",
                            message: "The entered account code is incorrect.",
                        },
                    });
                }
            } else {
                const verifiedKey = RedisKeys.sensitiveActionVerified(
                    userId,
                    "delete-game",
                    gameId
                );
                const isVerified = await redis.get(verifiedKey);
                if (isVerified !== "verified") {
                    return status(401, {
                        success: false,
                        error: {
                            code: "VERIFICATION_REQUIRED",
                            message:
                                "Purging game data requires verification via primary email OTP.",
                        },
                    });
                }
                await redis.del(verifiedKey);
            }

            const userGameRecords = await db.query.userGame.findMany({
                where: and(eq(userGame.userId, userId), eq(userGame.gameId, gameId)),
            });

            await db.transaction(async (tx) => {
                // Delete all pulls and the user_game links for this game
                await tx.delete(pull).where(and(eq(pull.userId, userId), eq(pull.gameId, gameId)));
                await tx
                    .delete(userGame)
                    .where(and(eq(userGame.userId, userId), eq(userGame.gameId, gameId)));
            });

            await redis.del(`stats:${userId}:${gameId}`);
            await redis.del(`stats:${userId}:${gameId}:all`);
            await redis.del(RedisKeys.userGameLatest(userId, gameId));
            for (const ug of userGameRecords) {
                if (ug.gameUid) {
                    await redis.del(`stats:${userId}:${gameId}:${ug.gameUid}`);
                    await redis.del(RedisKeys.userGameLatest(userId, gameId, ug.gameUid));
                }
            }

            return { success: true };
        },
        {
            params: t.Object({
                gameId: t.String(),
            }),
            body: t.Optional(
                t.Object({
                    code: t.Optional(t.String()),
                })
            ),
        }
    )

    // GET /user/auth-methods - Get all login methods and their counts
    .get("/auth-methods", async ({ user: sessionUser }) => {
        const userId = sessionUser!.id;
        return await getUserAuthMethodsCount(userId);
    })

    // POST /user/link-email - Trigger linking secondary email address
    .post(
        "/link-email",
        async ({ user: sessionUser, body: { email }, status, set, request }) => {
            const userId = sessionUser!.id;
            const emailLower = email.toLowerCase().trim();

            // 1. Check if email is already in user's secondary list
            const secondaries = await db.query.userEmails.findMany({
                where: eq(userEmails.userId, userId),
            });
            const isAlreadyAdded = secondaries.some((e) => e.email === emailLower);

            // 2. Enforce per-user rate limit
            if (isAlreadyAdded) {
                const resendRate = await checkRateLimit({
                    ip: userId,
                    action: "link_email_resend",
                    limit: 1,
                    windowSeconds: 60,
                });

                if (resendRate.limited) {
                    set.headers["Retry-After"] = resendRate.retryAfter.toString();
                    return status(429, {
                        success: false,
                        error: {
                            code: "TOO_MANY_REQUESTS",
                            message: `Too many resend attempts. Please try again in ${resendRate.retryAfter} seconds.`,
                            retryAfter: resendRate.retryAfter,
                        },
                    });
                }
            } else {
                const userRate = await checkRateLimit({
                    ip: userId,
                    action: "link_email_user",
                    limit: 5,
                    windowSeconds: 3600,
                });

                if (userRate.limited) {
                    set.headers["Retry-After"] = userRate.retryAfter.toString();
                    return status(429, {
                        success: false,
                        error: {
                            code: "TOO_MANY_REQUESTS",
                            message: `Too many email linking attempts. Please try again in ${Math.ceil(userRate.retryAfter / 60)} minutes.`,
                            retryAfter: userRate.retryAfter,
                        },
                    });
                }
            }

            // 3. Enforce per-IP rate limit (20 attempts/hour) - Softer warning-only threshold
            const ip =
                request.headers.get("x-forwarded-for") ??
                request.headers.get("x-real-ip") ??
                "127.0.0.1";
            const ipRate = await checkRateLimit({
                ip,
                action: "link_email_ip",
                limit: 20,
                windowSeconds: 3600,
            });

            if (ipRate.limited) {
                console.warn(
                    `[Rate Limit Warning] Suspicious IP-level email linking activity detected from IP: ${ip}`
                );
            }

            // Enforce per-IP rate limit: Hard block threshold (50 attempts/hour)
            // Silent block to avoid leaking the block state to the requester
            const ipRateHard = await checkRateLimit({
                ip,
                action: "link_email_ip_hard",
                limit: 50,
                windowSeconds: 3600,
            });

            if (ipRateHard.limited) {
                return status(200, { success: true });
            }

            // 4. Enforce maximum limit of 5 total email addresses
            const totalEmailsCount = 1 + secondaries.length;

            if (totalEmailsCount >= 5 && !isAlreadyAdded) {
                return status(400, {
                    success: false,
                    error: {
                        code: "TOO_MANY_EMAILS",
                        message: "You have reached the maximum limit of linked email addresses.",
                    },
                });
            }

            // 4. Check if email is already linked in the database
            const [existsInUser, existsInSecondary] = await Promise.all([
                db.query.user.findFirst({ where: eq(user.email, emailLower) }),
                db.query.userEmails.findFirst({ where: eq(userEmails.email, emailLower) }),
            ]);

            if (existsInUser) {
                const isOwnAccount = existsInUser.id === userId;
                if (isOwnAccount) {
                    return status(400, {
                        success: false,
                        error: {
                            code: "EMAIL_ALREADY_LINKED",
                            message: "This email address is already linked to your account.",
                        },
                    });
                } else {
                    return status(400, {
                        success: false,
                        error: {
                            code: "EMAIL_IN_USE",
                            message: "This email address is already in use by another user.",
                        },
                    });
                }
            }
            if (existsInSecondary) {
                const isOwnAccount = existsInSecondary.userId === userId;

                if (existsInSecondary.verified) {
                    if (isOwnAccount) {
                        return status(400, {
                            success: false,
                            error: {
                                code: "EMAIL_ALREADY_LINKED",
                                message: "This email address is already linked to your account.",
                            },
                        });
                    } else {
                        return status(400, {
                            success: false,
                            error: {
                                code: "EMAIL_IN_USE",
                                message: "This email address is already in use by another user.",
                            },
                        });
                    }
                }

                // If unverified secondary email belongs to a different user
                if (!isOwnAccount) {
                    const verificationWindowMs = 15 * 60 * 1000; // 15 minutes
                    const isWithinWindow =
                        Date.now() - existsInSecondary.createdAt.getTime() < verificationWindowMs;

                    if (isWithinWindow) {
                        return status(400, {
                            success: false,
                            error: {
                                code: "EMAIL_IN_USE",
                                message: "This email address is already in use by another user.",
                            },
                        });
                    }

                    // Delete the expired entry so the current user can link it
                    await db.delete(userEmails).where(eq(userEmails.email, emailLower));
                }
            }

            const key = RedisKeys.linkEmailOtp(userId, emailLower);
            await redis.del(key);

            // Insert into secondary list as unverified if not already present
            const existingRow = secondaries.find((e) => e.email === emailLower);

            if (!existingRow) {
                await db.insert(userEmails).values({
                    id: crypto.randomUUID(),
                    userId,
                    email: emailLower,
                    verified: false,
                });
            }

            // Generate 6-digit OTP code
            const code = randomInt(0, 1_000_000).toString().padStart(6, "0");

            // Store code in Redis
            await redis.hset(key, { code, attempts: 0 });
            await redis.expire(key, 900); // 15-minute TTL

            // Send email
            await sendOtpEmail({ email: emailLower, code, type: "email-verification" });

            return status(200, { success: true });
        },
        {
            body: t.Object({
                email: t.String({ format: "email" }),
            }),
        }
    )

    // POST /user/link-email/verify - Verify OTP code to link secondary email address
    .post(
        "/link-email/verify",
        async ({ user: sessionUser, body: { email, code }, status }) => {
            const userId = sessionUser!.id;
            const emailLower = email.toLowerCase().trim();
            const key = RedisKeys.linkEmailOtp(userId, emailLower);

            // Track failed attempts atomically
            const currentAttempts = await redis.hincrby(key, "attempts", 1);
            if (currentAttempts > 5) {
                await redis.del(key);
                return status(429, {
                    success: false,
                    error: {
                        code: "MAX_ATTEMPTS_EXCEEDED",
                        message: "Too many incorrect attempts. Please request a new code.",
                    },
                });
            }

            const storedCode = await redis.hget(key, "code");
            if (!storedCode) {
                return status(400, {
                    success: false,
                    error: {
                        code: "INVALID_OTP",
                        message: "The verification code is invalid or has expired.",
                    },
                });
            }

            if (storedCode !== code) {
                if (currentAttempts === 5) {
                    await redis.del(key);
                    return status(429, {
                        success: false,
                        error: {
                            code: "MAX_ATTEMPTS_EXCEEDED",
                            message: "Too many incorrect attempts. Please request a new code.",
                        },
                    });
                }
                return status(400, {
                    success: false,
                    error: {
                        code: "INVALID_OTP",
                        message: "The verification code is incorrect.",
                    },
                });
            }

            // Successful verification, delete the OTP key
            await redis.del(key);

            // 1. Verify that the pending secondary email row still exists in the database
            const pendingRow = await db.query.userEmails.findFirst({
                where: and(
                    eq(userEmails.userId, userId),
                    eq(userEmails.email, emailLower),
                    eq(userEmails.verified, false)
                ),
            });

            if (!pendingRow) {
                return status(400, {
                    success: false,
                    error: {
                        code: "INVALID_OR_EXPIRED_TOKEN",
                        message: "The email linking request has expired or was cancelled.",
                    },
                });
            }

            // 2. Mark secondary email as verified
            await db
                .update(userEmails)
                .set({ verified: true, verifiedAt: new Date() })
                .where(and(eq(userEmails.userId, userId), eq(userEmails.email, emailLower)));

            // 3. If primary user email is currently anonymous/de-identified, automatically promote this email to primary!
            const userRecord = await db.query.user.findFirst({
                where: eq(user.id, userId),
            });

            let promoted = false;
            if (userRecord) {
                const isDeidentified = userRecord.email.endsWith("@anon.gacha-tracker.app");

                if (isDeidentified) {
                    await db.transaction(async (tx) => {
                        // Delete from secondary list since it is now primary
                        await tx
                            .delete(userEmails)
                            .where(
                                and(eq(userEmails.userId, userId), eq(userEmails.email, emailLower))
                            );

                        // Promote to primary user table email
                        await tx
                            .update(user)
                            .set({
                                email: emailLower,
                                emailVerified: true,
                            })
                            .where(eq(user.id, userId));
                    });
                    promoted = true;
                }
            }

            return { success: true, promoted };
        },
        {
            body: t.Object({
                email: t.String({ format: "email" }),
                code: t.String(),
            }),
        }
    )

    // POST /user/unlink-secondary-email - Remove/unlink a secondary email address
    .post(
        "/unlink-secondary-email",
        async ({ user: sessionUser, body: { email }, status }) => {
            const userId = sessionUser!.id;
            const emailLower = email.toLowerCase().trim();

            const existing = await db.query.userEmails.findFirst({
                where: and(eq(userEmails.userId, userId), eq(userEmails.email, emailLower)),
            });

            if (!existing) {
                return status(404, {
                    success: false,
                    error: {
                        code: "EMAIL_NOT_FOUND",
                        message: "This email address is not linked to your account.",
                    },
                });
            }

            const isAnonymous =
                sessionUser!.isAnonymous || sessionUser!.email.endsWith("@anon.gacha-tracker.app");
            if (existing.verified && !isAnonymous) {
                const verifiedKey = RedisKeys.sensitiveActionVerified(
                    userId,
                    "unlink-secondary-email",
                    emailLower
                );
                const isVerified = await redis.get(verifiedKey);
                if (isVerified !== "verified") {
                    return status(401, {
                        success: false,
                        error: {
                            code: "VERIFICATION_REQUIRED",
                            message:
                                "Unlinking a secondary email requires verification via primary email OTP.",
                        },
                    });
                }
                await redis.del(verifiedKey);
            }

            await db
                .delete(userEmails)
                .where(and(eq(userEmails.userId, userId), eq(userEmails.email, emailLower)));

            if (!existing.verified) {
                const linkKey = RedisKeys.linkEmailOtp(userId, emailLower);
                await redis.del(linkKey);
            }

            return { success: true };
        },
        {
            body: t.Object({
                email: t.String(),
            }),
        }
    )

    // POST /user/unlink-email-otp - Request OTP code for primary email removal
    .post(
        "/unlink-email-otp",
        async ({ user: sessionUser, body, status, set }) => {
            const userId = sessionUser!.id;
            const useSecondaryEmail = body?.useSecondaryEmail;

            const isAnonymous =
                sessionUser!.isAnonymous || sessionUser!.email.endsWith("@anon.gacha-tracker.app");
            if (isAnonymous) {
                return status(400, {
                    success: false,
                    error: {
                        code: "ANONYMOUS_EMAIL",
                        message:
                            "Anonymous accounts do not have a primary email that can be unlinked.",
                    },
                });
            }

            const methods = await getUserAuthMethodsCount(userId);
            const verifiedSecondaries = methods.secondaryEmails.filter((e) => e.verified);

            if (verifiedSecondaries.length === 0) {
                return status(400, {
                    success: false,
                    error: {
                        code: "NO_VERIFIED_SECONDARY_EMAIL",
                        message:
                            "You must link and verify a secondary email address before you can remove your primary email.",
                    },
                });
            }

            let emailToSend = sessionUser!.email;

            if (useSecondaryEmail) {
                const emailLower = useSecondaryEmail.toLowerCase().trim();
                const matched = verifiedSecondaries.find((e) => e.email === emailLower);

                if (!matched) {
                    return status(400, {
                        success: false,
                        error: {
                            code: "EMAIL_NOT_VERIFIED",
                            message:
                                "The selected secondary email is not verified or linked to your account.",
                        },
                    });
                }

                const verifiedTime = matched.verifiedAt ? new Date(matched.verifiedAt) : null;
                if (!verifiedTime || Date.now() - verifiedTime.getTime() < 48 * 60 * 60 * 1000) {
                    return status(400, {
                        success: false,
                        error: {
                            code: "VERIFICATION_PERIOD_INSUFFICIENT",
                            message:
                                "The secondary email must be verified for at least 48 hours to be used in the 'lost access' recovery flow.",
                        },
                    });
                }

                emailToSend = emailLower;
            }

            // Rate limiting (5 attempts/hour)
            const rateLimit = await checkRateLimit({
                ip: userId,
                action: "unlink_email_otp_user",
                limit: 5,
                windowSeconds: 3600,
            });
            if (rateLimit.limited) {
                set.headers["Retry-After"] = rateLimit.retryAfter.toString();
                return status(429, {
                    success: false,
                    error: {
                        code: "TOO_MANY_REQUESTS",
                        message: `Too many email unlink code requests. Please try again in ${Math.ceil(rateLimit.retryAfter / 60)} minutes.`,
                        retryAfter: rateLimit.retryAfter,
                    },
                });
            }

            // Generate 6-digit CSPRNG OTP
            const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
            const key = RedisKeys.unlinkEmailOtp(userId, emailToSend);

            // Store in Redis as Hash
            await redis.hset(key, { code, attempts: 0 });
            await redis.expire(key, 300); // 5-minute TTL

            // Send email
            await sendOtpEmail({ email: emailToSend, code, type: "unlink-primary-email" });

            return { success: true, email: emailToSend };
        },
        {
            body: t.Optional(
                t.Object({
                    useSecondaryEmail: t.Optional(t.String()),
                })
            ),
        }
    )

    // POST /user/unlink-email - De-identify user primary email
    .post(
        "/unlink-email",
        async ({ user: sessionUser, body, status }) => {
            const userId = sessionUser!.id;
            const emailToPromote = body?.emailToPromote;
            const code = body?.code;

            const methods = await getUserAuthMethodsCount(userId);
            const verifiedSecondaries = methods.secondaryEmails.filter((e) => e.verified);

            if (verifiedSecondaries.length === 0) {
                return status(400, {
                    success: false,
                    error: {
                        code: "NO_VERIFIED_SECONDARY_EMAIL",
                        message:
                            "You must link and verify a secondary email address before you can remove your primary email.",
                    },
                });
            }

            const isAnonymous =
                sessionUser!.isAnonymous || sessionUser!.email.endsWith("@anon.gacha-tracker.app");

            if (!isAnonymous) {
                if (!code) {
                    return status(400, {
                        success: false,
                        error: {
                            code: "INVALID_OTP",
                            message: "Verification code is required.",
                        },
                    });
                }

                // Determine which OTP key to check
                let otpEmail = sessionUser!.email;
                let isSecondaryOtp = false;

                if (emailToPromote) {
                    const normalizedPromote = emailToPromote.toLowerCase().trim();
                    const secondaryKey = RedisKeys.unlinkEmailOtp(userId, normalizedPromote);
                    const hasSecondaryOtp = await redis.exists(secondaryKey);
                    if (hasSecondaryOtp) {
                        otpEmail = normalizedPromote;
                        isSecondaryOtp = true;
                    }
                }

                const key = RedisKeys.unlinkEmailOtp(userId, otpEmail);

                // If it's a secondary OTP, verify the 48-hour requirement again!
                if (isSecondaryOtp) {
                    const matched = verifiedSecondaries.find((e) => e.email === otpEmail);
                    if (!matched) {
                        return status(400, {
                            success: false,
                            error: {
                                code: "EMAIL_NOT_VERIFIED",
                                message:
                                    "The secondary email is not verified or linked to your account.",
                            },
                        });
                    }
                    const verifiedTime = matched.verifiedAt ? new Date(matched.verifiedAt) : null;
                    if (
                        !verifiedTime ||
                        Date.now() - verifiedTime.getTime() < 48 * 60 * 60 * 1000
                    ) {
                        return status(400, {
                            success: false,
                            error: {
                                code: "VERIFICATION_PERIOD_INSUFFICIENT",
                                message:
                                    "The secondary email must be verified for at least 48 hours to be used in the 'lost access' recovery flow.",
                            },
                        });
                    }
                }

                // Track failed attempts atomically
                const currentAttempts = await redis.hincrby(key, "attempts", 1);
                if (currentAttempts > 5) {
                    await redis.del(key);
                    return status(429, {
                        success: false,
                        error: {
                            code: "MAX_ATTEMPTS_EXCEEDED",
                            message: "Too many incorrect attempts. Please request a new code.",
                        },
                    });
                }

                const storedCode = await redis.hget(key, "code");
                if (!storedCode) {
                    return status(400, {
                        success: false,
                        error: {
                            code: "INVALID_OTP",
                            message: "The verification code is invalid or has expired.",
                        },
                    });
                }

                if (storedCode !== code) {
                    if (currentAttempts === 5) {
                        await redis.del(key);
                        return status(429, {
                            success: false,
                            error: {
                                code: "MAX_ATTEMPTS_EXCEEDED",
                                message: "Too many incorrect attempts. Please request a new code.",
                            },
                        });
                    }
                    return status(400, {
                        success: false,
                        error: {
                            code: "INVALID_OTP",
                            message: "The verification code is incorrect.",
                        },
                    });
                }

                // Successful verification, delete the OTP key
                await redis.del(key);
            }

            let toPromote = verifiedSecondaries[0].email;
            if (emailToPromote) {
                const normalizedPromote = emailToPromote.toLowerCase().trim();
                const matched = verifiedSecondaries.find((e) => e.email === normalizedPromote);
                if (!matched) {
                    return status(400, {
                        success: false,
                        error: {
                            code: "EMAIL_NOT_VERIFIED",
                            message:
                                "The requested email address is not verified or linked to your account.",
                        },
                    });
                }
                toPromote = matched.email;
            } else if (verifiedSecondaries.length > 1) {
                return status(400, {
                    success: false,
                    error: {
                        code: "MULTIPLE_VERIFIED_EMAILS",
                        message:
                            "Multiple verified secondary emails exist. You must specify which one to promote.",
                    },
                });
            }

            await db.transaction(async (tx) => {
                // Delete from secondary list
                await tx
                    .delete(userEmails)
                    .where(and(eq(userEmails.userId, userId), eq(userEmails.email, toPromote)));
                // Update primary user email
                await tx
                    .update(user)
                    .set({
                        email: toPromote,
                        emailVerified: true,
                    })
                    .where(eq(user.id, userId));
            });
            return { success: true, email: toPromote, promoted: true };
        },
        {
            body: t.Optional(
                t.Object({
                    code: t.Optional(t.String()),
                    emailToPromote: t.Optional(t.String()),
                })
            ),
        }
    )

    // POST /user/sensitive-action-otp - Request OTP for a sensitive action
    .post(
        "/sensitive-action-otp",
        async ({ user: sessionUser, body: { action, target }, status, set }) => {
            const userId = sessionUser!.id;
            const resolvedTarget = target ?? "";

            const isAnonymous =
                sessionUser!.isAnonymous || sessionUser!.email.endsWith("@anon.gacha-tracker.app");
            if (isAnonymous) {
                return status(400, {
                    success: false,
                    error: {
                        code: "ANONYMOUS_ACCOUNT",
                        message: "Anonymous accounts cannot receive email OTPs.",
                    },
                });
            }

            // Rate limiting (5 attempts/hour)
            const rateLimit = await checkRateLimit({
                ip: userId,
                action: `sensitive_action_otp_${action}`,
                limit: 5,
                windowSeconds: 3600,
            });
            if (rateLimit.limited) {
                set.headers["Retry-After"] = rateLimit.retryAfter.toString();
                return status(429, {
                    success: false,
                    error: {
                        code: "TOO_MANY_REQUESTS",
                        message: `Too many code requests. Please try again in ${Math.ceil(rateLimit.retryAfter / 60)} minutes.`,
                        retryAfter: rateLimit.retryAfter,
                    },
                });
            }

            // Generate 6-digit CSPRNG OTP
            const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
            const key = RedisKeys.sensitiveActionOtp(userId, action, resolvedTarget);

            // Store in Redis as Hash
            await redis.hset(key, { code, attempts: 0 });
            await redis.expire(key, 300); // 5-minute TTL

            await sendOtpEmail({ email: sessionUser!.email, code, type: action });

            return { success: true };
        },
        {
            body: t.Object({
                action: t.Union([
                    t.Literal("delete-account"),
                    t.Literal("delete-game"),
                    t.Literal("delete-profile"),
                    t.Literal("unlink-secondary-email"),
                    t.Literal("unlink-social"),
                ]),
                target: t.Optional(t.String()),
            }),
        }
    )

    // POST /user/verify-sensitive-action - Verify OTP and set temporary token in Redis
    .post(
        "/verify-sensitive-action",
        async ({ user: sessionUser, body: { action, target, code }, status }) => {
            const userId = sessionUser!.id;
            const resolvedTarget = target ?? "";

            const isAnonymous =
                sessionUser!.isAnonymous || sessionUser!.email.endsWith("@anon.gacha-tracker.app");
            if (isAnonymous) {
                return status(400, {
                    success: false,
                    error: {
                        code: "ANONYMOUS_ACCOUNT",
                        message: "Anonymous accounts cannot verify email OTPs.",
                    },
                });
            }

            const key = RedisKeys.sensitiveActionOtp(userId, action, resolvedTarget);

            // Track failed attempts atomically
            const currentAttempts = await redis.hincrby(key, "attempts", 1);
            if (currentAttempts > 5) {
                await redis.del(key);
                return status(429, {
                    success: false,
                    error: {
                        code: "MAX_ATTEMPTS_EXCEEDED",
                        message: "Too many incorrect attempts. Please request a new code.",
                    },
                });
            }

            const storedCode = await redis.hget(key, "code");
            if (!storedCode) {
                return status(400, {
                    success: false,
                    error: {
                        code: "INVALID_OTP",
                        message: "The verification code is invalid or has expired.",
                    },
                });
            }

            if (storedCode !== code) {
                if (currentAttempts === 5) {
                    await redis.del(key);
                    return status(429, {
                        success: false,
                        error: {
                            code: "MAX_ATTEMPTS_EXCEEDED",
                            message: "Too many incorrect attempts. Please request a new code.",
                        },
                    });
                }
                return status(400, {
                    success: false,
                    error: {
                        code: "INVALID_OTP",
                        message: "The verification code is incorrect.",
                    },
                });
            }

            // Successful verification, delete OTP key
            await redis.del(key);

            // Set verified token in Redis for 5 minutes
            const verifiedKey = RedisKeys.sensitiveActionVerified(userId, action, resolvedTarget);
            await redis.set(verifiedKey, "verified", "EX", 300);

            return { success: true };
        },
        {
            body: t.Object({
                action: t.Union([
                    t.Literal("delete-account"),
                    t.Literal("delete-game"),
                    t.Literal("delete-profile"),
                    t.Literal("unlink-secondary-email"),
                    t.Literal("unlink-social"),
                ]),
                target: t.Optional(t.String()),
                code: t.String(),
            }),
        }
    )

    // POST /user/delete-otp - Request OTP code for account deletion
    .post(
        "/delete-otp",
        async ({ user: sessionUser, body: { email }, status, set }) => {
            const userId = sessionUser!.id;
            const emailLower = email.toLowerCase().trim();

            if (emailLower !== sessionUser!.email.toLowerCase().trim()) {
                return status(400, {
                    success: false,
                    error: {
                        code: "INVALID_EMAIL",
                        message: "Account deletion OTP can only be sent to your primary email.",
                    },
                });
            }

            // Rate limiting (5 attempts/hour)
            const rateLimit = await checkRateLimit({
                ip: userId,
                action: "delete_otp_user",
                limit: 5,
                windowSeconds: 3600,
            });
            if (rateLimit.limited) {
                set.headers["Retry-After"] = rateLimit.retryAfter.toString();
                return status(429, {
                    success: false,
                    error: {
                        code: "TOO_MANY_REQUESTS",
                        message: `Too many deletion code requests. Please try again in ${Math.ceil(rateLimit.retryAfter / 60)} minutes.`,
                        retryAfter: rateLimit.retryAfter,
                    },
                });
            }

            // Generate 6-digit CSPRNG OTP
            const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
            const key = RedisKeys.sensitiveActionOtp(userId, "delete-account", "");

            // Store in Redis as Hash
            await redis.hset(key, { code, attempts: 0 });
            await redis.expire(key, 300); // 5-minute TTL

            // Send email
            await sendOtpEmail({ email: emailLower, code, type: "delete-account" });

            return { success: true };
        },
        {
            body: t.Object({
                email: t.String({ format: "email" }),
            }),
        }
    )

    // DELETE /user - Cascade delete entire account and sessions after secure re-authentication
    .delete(
        "/",
        async ({ user: sessionUser, body, cookie, status }) => {
            const userId = sessionUser!.id;
            const userRecord = await db.query.user.findFirst({
                where: eq(user.id, userId),
            });
            if (!userRecord) {
                return status(404, {
                    success: false,
                    error: { code: "USER_NOT_FOUND", message: "User not found" },
                });
            }

            if (body.type === "anonymous") {
                if (!userRecord.isAnonymous || !userRecord.codeHash) {
                    return status(400, {
                        success: false,
                        error: {
                            code: "NOT_ANONYMOUS_ACCOUNT",
                            message:
                                "This verification method is only available for anonymous accounts.",
                        },
                    });
                }
                const isValid = await Bun.password.verify(body.code, userRecord.codeHash);
                if (!isValid) {
                    return status(400, {
                        success: false,
                        error: {
                            code: "INVALID_CODE",
                            message: "The entered account code is incorrect.",
                        },
                    });
                }
            } else if (body.type === "email") {
                const emailLower = body.email.toLowerCase().trim();

                if (emailLower !== userRecord.email.toLowerCase().trim()) {
                    return status(400, {
                        success: false,
                        error: {
                            code: "INVALID_EMAIL",
                            message:
                                "Account deletion OTP must be verified using your primary email.",
                        },
                    });
                }

                // Check pre-verified key first
                const verifiedKey = RedisKeys.sensitiveActionVerified(userId, "delete-account", "");
                const isVerified = await redis.get(verifiedKey);
                if (isVerified === "verified") {
                    await redis.del(verifiedKey);
                } else {
                    // Fallback to direct OTP verification
                    const key = RedisKeys.sensitiveActionOtp(userId, "delete-account", "");

                    const currentAttempts = await redis.hincrby(key, "attempts", 1);
                    if (currentAttempts > 5) {
                        await redis.del(key);
                        return status(429, {
                            success: false,
                            error: {
                                code: "MAX_ATTEMPTS_EXCEEDED",
                                message: "Too many incorrect attempts. Please request a new code.",
                            },
                        });
                    }

                    const storedCode = await redis.hget(key, "code");
                    if (!storedCode) {
                        return status(400, {
                            success: false,
                            error: {
                                code: "INVALID_OTP",
                                message: "The verification code is invalid or has expired.",
                            },
                        });
                    }

                    if (storedCode !== body.code) {
                        if (currentAttempts === 5) {
                            await redis.del(key);
                            return status(429, {
                                success: false,
                                error: {
                                    code: "MAX_ATTEMPTS_EXCEEDED",
                                    message:
                                        "Too many incorrect attempts. Please request a new code.",
                                },
                            });
                        }
                        return status(400, {
                            success: false,
                            error: {
                                code: "INVALID_OTP",
                                message: "The verification code is incorrect.",
                            },
                        });
                    }

                    // Successful verification, delete the OTP key
                    await redis.del(key);
                }
            } else if (body.type === "social") {
                // Verify via pre-verified sensitive action token
                const verifiedKey = RedisKeys.sensitiveActionVerified(userId, "delete-account", "");
                const isVerified = await redis.get(verifiedKey);
                if (isVerified !== "verified") {
                    // Check if social delete reauth fallback key exists (for better-auth backwards compat in test)
                    const authKey = RedisKeys.deleteAuth(userId);
                    const isSocialVerified = await redis.get(authKey);
                    if (isSocialVerified === "verified") {
                        await redis.del(authKey);
                    } else {
                        return status(401, {
                            success: false,
                            error: {
                                code: "VERIFICATION_REQUIRED",
                                message:
                                    "Account deletion requires verification via primary email OTP.",
                            },
                        });
                    }
                } else {
                    await redis.del(verifiedKey);
                }
            } else {
                return status(400, {
                    success: false,
                    error: {
                        code: "INVALID_REAUTH_TYPE",
                        message: "Invalid re-authentication type.",
                    },
                });
            }

            // Verification succeeded, execute instant hard deletion!
            await db.delete(user).where(eq(user.id, userId));

            await auth.api.revokeUserSessions({
                body: {
                    userId,
                },
            });

            cookie["better-auth.session_token"]?.remove();

            return { success: true };
        },
        {
            body: t.Union([
                t.Object({
                    type: t.Literal("anonymous"),
                    code: t.String(),
                }),
                t.Object({
                    type: t.Literal("email"),
                    email: t.String(),
                    code: t.String(),
                }),
                t.Object({
                    type: t.Literal("social"),
                    provider: t.String(),
                }),
            ]),
        }
    );
