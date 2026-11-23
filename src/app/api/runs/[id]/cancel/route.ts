import { route } from "@/server/http";
import { requestCancel } from "@/server/engine/engine";
export const dynamic = "force-dynamic";
export const POST = route<{ id: string }>((_req, { id }) => {
  requestCancel(id);
  return { cancelling: true };
});
