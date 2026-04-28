import { Elysia, t } from "elysia";
import { createSubscriberClient } from "../../lib/redis";
import { authPlugin } from "../auth";

export const eventsRouter = new Elysia({ prefix: "/pulls" }).use(authPlugin).get(
    "/import/events",
    async ({ user, query }) => {
        const { gameId } = query;
        const channel = `import:${user!.id}:${gameId}`;

        // Dedicated subscriber client — cannot reuse the shared command client
        const subscriber = createSubscriberClient();

        let isClosed = false;
        let cleanup: (() => void) | null = null;

        const stream = new ReadableStream({
            start(controller) {
                const sendEvent = (event: string | object) => {
                    try {
                        const payload = typeof event === "string" ? event : JSON.stringify(event);
                        controller.enqueue(`data: ${payload}\n\n`);
                        return true;
                    } catch {
                        // Stream likely closed or consumer disconnected
                        return false;
                    }
                };

                sendEvent({ type: "connected" });

                const safeClose = () => {
                    if (isClosed) return;
                    isClosed = true;
                    cleanup?.();
                    try {
                        controller.close();
                    } catch {
                        // Already closed or errored
                    }
                };

                const timeout = setTimeout(
                    () => {
                        if (!isClosed) {
                            sendEvent({ type: "timeout" });
                            safeClose();
                        }
                    },
                    15 * 60 * 1000
                );

                subscriber.subscribe(channel);
                subscriber.on("message", (_ch, message) => {
                    if (isClosed) return;

                    if (sendEvent(message)) {
                        try {
                            const parsed = JSON.parse(message);
                            if (parsed.type === "complete" || parsed.type === "timeout") {
                                safeClose();
                            }
                        } catch {
                            console.error(
                                `[events:parse-error] Failed to parse message: ${message}`
                            );
                        }
                    } else {
                        safeClose();
                    }
                });

                cleanup = () => {
                    clearTimeout(timeout);
                    subscriber.unsubscribe(channel).catch(() => {});
                    subscriber.quit().catch(() => {});
                };
            },
            cancel() {
                isClosed = true;
                cleanup?.();
            },
        });

        return new Response(stream, {
            headers: {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                Connection: "keep-alive",
            },
        });
    },
    {
        auth: true,
        query: t.Object({ gameId: t.String() }),
    }
);
