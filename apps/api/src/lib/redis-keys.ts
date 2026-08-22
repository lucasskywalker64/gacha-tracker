export const RedisKeys = {
    deleteOtp: (userId: string, email: string) => `delete_otp:${userId}:${email.toLowerCase()}`,
    unlinkEmailOtp: (userId: string, email: string) =>
        `unlink_email_otp:${userId}:${email.toLowerCase()}`,
    deleteAuth: (userId: string) => `delete_auth:${userId}`,
    authConflict: (token: string) => `auth_conflict:${token}`,
    authConflictOtp: (token: string) => `auth_conflict_otp:${token}`,
    emailVerify: (token: string) => `email_verify:${token}`,
    activeVerifyToken: (userId: string, email: string) =>
        `active_verify_token:${userId}:${email.toLowerCase()}`,
    anonPending: (identifier: string) => `anon_pending:${identifier}`,
    sensitiveActionOtp: (userId: string, action: string, target: string) =>
        `sensitive_action_otp:${userId}:${action}:${target.toLowerCase()}`,
    sensitiveActionVerified: (userId: string, action: string, target: string) =>
        `sensitive_action_verified:${userId}:${action}:${target.toLowerCase()}`,
    linkEmailOtp: (userId: string, email: string) =>
        `link_email_otp:${userId}:${email.toLowerCase()}`,
    importCooldown: (userId: string) => `import_cooldown:${userId}`,
    stats: (userId: string, gameId: string, scope?: string) =>
        scope ? `stats:${userId}:${gameId}:${scope}` : `stats:${userId}:${gameId}`,
    userGameLatest: (userId: string, gameId: string, gameUid?: string) =>
        gameUid
            ? `user_game_latest:${userId}:${gameId}:${gameUid}`
            : `user_game_latest:${userId}:${gameId}`,
    gamesList: () => "static:games:active",
} as const;
