import { z } from "zod";
import { body, notFound, route } from "@/server/http";
import { ASSET_ROLES, getAsset, lineage, setAssetRole } from "@/server/assets";
export const dynamic = "force-dynamic";
export const GET = route<{ id: string }>((_req, { id }) => {
  const a = getAsset(id) ?? notFound("asset");
  return { asset: a, lineage: lineage(id) };
});
/** Tell Orkestr what an asset is for (logo, photo, music…). Planning uses roles instead of asking. */
export const PATCH = route<{ id: string }>(async (req, { id }) => {
  if (!getAsset(id)) notFound("asset");
  const { role } = z.object({ role: z.enum(ASSET_ROLES).nullable() }).parse(await body(req));
  return setAssetRole(id, role);
});
