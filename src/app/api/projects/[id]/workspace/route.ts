import { notFound, route } from "@/server/http";
import { workspace } from "@/server/producer";
export const dynamic = "force-dynamic";
export const GET = route<{ id: string }>((_req, { id }) => workspace(id) ?? notFound("project"));
