import { notFound, route } from "@/server/http";
import { runDetail } from "@/server/views";
export const dynamic = "force-dynamic";
export const GET = route<{ id: string }>((_req, { id }) => runDetail(id) ?? notFound("run"));
