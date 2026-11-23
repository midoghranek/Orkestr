import { body, notFound, route } from "@/server/http";
import { getScene, updateScene } from "@/server/projects";
import { listAssets } from "@/server/assets";
export const dynamic = "force-dynamic";
export const GET = route<{ id: string }>((_req, { id }) => {
  const s = getScene(id) ?? notFound("scene");
  return { scene: s, versions: listAssets(s.projectId, { sceneId: id }) };
});
export const PATCH = route<{ id: string }>(async (req, { id }) => updateScene(id, await body(req)));
