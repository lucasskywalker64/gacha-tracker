import { Resend } from "resend";
import { config } from "../config";

const resend = new Resend(config.RESEND_API_KEY);

/**
 * Sends a magic-link email via Resend.
 * Called by the Better-Auth `magicLink` plugin on every sign-in request.
 */
export async function sendMagicLinkEmail({
    email,
    url,
}: {
    email: string;
    url: string;
    token: string;
}): Promise<void> {
    const { error } = await resend.emails.send(
        {
            from: "Gacha Tracker <auth@mail.gacha-tracker.app>",
            to: [email],
            subject: "Your Gacha Tracker login link",
            html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
                <h2>Welcome to Gacha Tracker</h2>
                <p>Click the link below to sign in to your account. This link expires in 5 minutes and can only be used once.</p>
                <div style="margin: 32px 0;">
                    <a href="${url}" style="background-color: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 500;">Sign in to Gacha Tracker</a>
                </div>
                <p style="color: #6b7280; font-size: 14px;">If you didn't request this, you can safely ignore this email.</p>
            </div>
        `,
            text: `Sign in to Gacha Tracker: ${url}\n\nThis link expires in 5 minutes and can only be used once.\nIf you didn't request this, you can safely ignore this email.`,
            tags: [{ name: "category", value: "magic-link" }],
        },
        {
            idempotencyKey: `magic-link/${email}/${Date.now()}`,
        }
    );

    if (error) {
        throw new Error(`Resend error: ${error.message}`);
    }
}
