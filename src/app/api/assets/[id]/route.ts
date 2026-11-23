import { notFound, route } from "@/server/http";
import { getAsset, lineage } from "@/server/assets";
export const dynamic = "force-dynamic";
export const GET = route<{ id: string }>((_req, { id }) => {
  const a = getAsset(id) ?? notFound("asset");
  return { asset: a, lineage: lineage(id) };
});
