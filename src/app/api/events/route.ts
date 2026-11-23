import type { NextRequest } from "next/server";
import { errorResponse, guard } from "@/server/http";
import { eventsSince, latestEventId } from "@/server/events";
export const dynamic = "force-dynamic";

/** Server-Sent Events: tails the durable events table (works across the web and worker processes). */
export async function GET(req: NextRequest) {
  try {
    guard(req);
  } catch (e) {
    return errorResponse(e);
  }
  const u = req.nextUrl.searchParams;
  const runId = u.get("runId") ?? undefined;
  const projectId = u.get("projectId") ?? undefined;
  let cursor = u.has("after") ? Number(u.get("after")) : Math.max(0, latestEventId() - 50);
  const enc = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  const stream = new ReadableStream({
    start(controller) {
      const send = () => {
        try {
          const rows = eventsSince(cursor, { runId, projectId, limit: 200 });
          for (const r of rows) {
            cursor = r.id;
            controller.enqueue(enc.encode(`id: ${r.id}\nevent: event\ndata: ${JSON.stringify(r)}\n\n`));
          }
          controller.enqueue(enc.encode(`: ping\n\n`));
        } catch {
          /* db busy: try again next tick */
        }
      };
      send();
      timer = setInterval(send, 700);
      req.signal.addEventListener("abort", () => {
        if (timer) clearInterval(timer);
        try {
          controller.close();
        } catch {
          /* closed */
        }
      });
    },
    cancel() {
      if (timer) clearInterval(timer);
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}
