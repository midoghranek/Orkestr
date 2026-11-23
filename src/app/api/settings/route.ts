import { body, route } from "@/server/http";
import { onlyProvided } from "@/server/util/ids";
import { SettingsSchema, getSettings, updateSettings } from "@/server/settings";
export const dynamic = "force-dynamic";
export const GET = route(() => getSettings());
export const PUT = route(async (req) => {
  const raw = await body<Record<string, unknown>>(req);
  return updateSettings(onlyProvided(raw, SettingsSchema.partial().parse(raw)));
});
