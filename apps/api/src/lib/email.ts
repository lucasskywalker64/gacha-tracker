import { Resend } from "resend";
import { config } from "../config";
import { join } from "path";

const resend = new Resend(config.RESEND_API_KEY);

const OTP_ACTION_LABEL: Record<
    | "sign-in"
    | "email-verification"
    | "forget-password"
    | "change-email"
    | "delete-account"
    | "unlink-primary-email"
    | "delete-game"
    | "delete-profile"
    | "unlink-secondary-email"
    | "unlink-social",
    string
> = {
    "sign-in": "signing in",
    "email-verification": "verifying your email",
    "forget-password": "resetting your password",
    "change-email": "changing your email",
    "delete-account": "authorizing account deletion",
    "unlink-primary-email": "unlinking your primary email",
    "delete-game": "purging game data",
    "delete-profile": "purging profile data",
    "unlink-secondary-email": "unlinking a secondary email",
    "unlink-social": "unlinking a social provider",
};

async function renderTemplate(vars: {
    heading: string;
    bodyText: string;
    actionContent: string;
    footerText: string;
}): Promise<string> {
    const templatePath = join(import.meta.dir, "..", "templates", "email.html");
    const file = Bun.file(templatePath);
    let content = await file.text();
    content = content.replaceAll("{{heading}}", vars.heading);
    content = content.replaceAll("{{bodyText}}", vars.bodyText);
    content = content.replaceAll("{{actionContent}}", vars.actionContent);
    content = content.replaceAll("{{footerText}}", vars.footerText);
    return content;
}

async function renderCodeBlock(code: string, color: string): Promise<string> {
    const templatePath = join(import.meta.dir, "..", "templates", "action-code.html");
    const file = Bun.file(templatePath);
    let content = await file.text();
    content = content.replaceAll("{{code}}", code);
    content = content.replaceAll("{{color}}", color);
    return content;
}

export async function sendOtpEmail({
    email,
    code,
    type,
}: {
    email: string;
    code: string;
    type:
        | "sign-in"
        | "email-verification"
        | "forget-password"
        | "change-email"
        | "delete-account"
        | "unlink-primary-email"
        | "delete-game"
        | "delete-profile"
        | "unlink-secondary-email"
        | "unlink-social";
}): Promise<void> {
    const recipient = email.toLowerCase().trim();
    const { error } = await resend.emails.send(
        {
            from: "Gacha Tracker <auth@mail.gacha-tracker.app>",
            to: [recipient],
            subject: "Your Gacha Tracker OTP code",
            html: await renderTemplate({
                heading: "Gacha Tracker Security Code",
                bodyText: `You requested a one-time password for ${OTP_ACTION_LABEL[type]}.`,
                actionContent: await renderCodeBlock(code, "#38bdf8"),
                footerText:
                    "This code will expire in 5 minutes. If you did not request this, please ignore this email.",
            }),
            text: `Your Gacha Tracker security code is: ${code}\n\nThis code will expire in 5 minutes. If you did not request this, please ignore this email.`,
            tags: [{ name: "category", value: "otp" }],
        },
        {
            idempotencyKey: `otp/${recipient}/${Math.floor(Date.now() / 60000)}`,
        }
    );

    if (error) {
        const msg = error.message.toLowerCase();
        if (msg.includes("idempotency") || msg.includes("duplicate")) {
            throw new Error(
                "An OTP code was already sent recently. Please check your inbox or wait a minute before trying again."
            );
        }
        throw new Error(`Resend error: ${error.message}`);
    }
}

export async function sendConflictOtpEmail({
    email,
    code,
    provider,
}: {
    email: string;
    code: string;
    provider: string;
}): Promise<void> {
    const recipient = email.toLowerCase().trim();
    const formattedProvider = provider.charAt(0).toUpperCase() + provider.slice(1);
    const { error } = await resend.emails.send(
        {
            from: "Gacha Tracker <auth@mail.gacha-tracker.app>",
            to: [recipient],
            subject: `Confirm linking your ${formattedProvider} account`,
            html: await renderTemplate({
                heading: "Link Social Account",
                bodyText: `Confirm linking your ${formattedProvider} account to your Gacha Tracker profile.`,
                actionContent: await renderCodeBlock(code, "#f472b6"),
                footerText:
                    "This code will expire in 5 minutes. If you did not request this, please ignore this email.",
            }),
            text: `Confirm linking your ${formattedProvider} account with this code: ${code}\n\nThis code will expire in 5 minutes. If you did not request this, please ignore this email.`,
            tags: [{ name: "category", value: "conflict-otp" }],
        },
        {
            idempotencyKey: `conflict-otp/${recipient}/${Math.floor(Date.now() / 60000)}`,
        }
    );

    if (error) {
        const msg = error.message.toLowerCase();
        if (msg.includes("idempotency") || msg.includes("duplicate")) {
            throw new Error(
                "A link verification code was already sent recently. Please check your inbox or wait a minute."
            );
        }
        throw new Error(`Resend error: ${error.message}`);
    }
}
