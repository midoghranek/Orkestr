import { notFound, route } from "@/server/http";
import { getPlan } from "@/server/director";
export const dynamic = "force-dynamic";
export const GET = route<{ id: string }>((_req, { id }) => getPlan(id) ?? notFound("plan"));
