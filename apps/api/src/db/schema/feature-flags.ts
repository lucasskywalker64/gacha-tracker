import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { sql, relations } from "drizzle-orm";
import { users } from "./users";

/**
 * feature_flags
 *
 * All feature flags stored as DB rows so they can be toggled from the admin
 * dashboard without a redeploy or SSH session.
 */
export const featureFlags = sqliteTable("feature_flags", {
    key: text("key").primaryKey(),
    enabled: integer("enabled").notNull().default(0),
    updatedAt: integer("updated_at")
        .notNull()
        .default(sql`(unixepoch())`),
});

export type FeatureFlag = typeof featureFlags.$inferSelect;

/**
 * admin_audit_logs
 *
 * Paper trail for all mutating admin actions: toggling games/flags, deleting
 * users, flushing cache, etc.
 */
export const adminAuditLogs = sqliteTable("admin_audit_logs", {
    id: text("id").primaryKey(),
    adminId: text("admin_id")
        .notNull()
        .references(() => users.id),
    action: text("action").notNull(),
    target: text("target"),
    payload: text("payload"),
    createdAt: integer("created_at")
        .notNull()
        .default(sql`(unixepoch())`),
});

export type AdminAuditLog = typeof adminAuditLogs.$inferSelect;
export type NewAdminAuditLog = typeof adminAuditLogs.$inferInsert;

// ---------------------------------------------------------------------------
// Relations
// ---------------------------------------------------------------------------
export const adminAuditLogsRelations = relations(adminAuditLogs, ({ one }) => ({
    admin: one(users, { fields: [adminAuditLogs.adminId], references: [users.id] }),
}));
