import { route } from "@/server/http";
import { recover } from "@/server/producer";
export const dynamic = "force-dynamic";
export const POST = route<{ id: string }>((_req, { id }) => recover(id));
