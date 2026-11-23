import { z } from "zod";
import { body, route } from "@/server/http";
import { PROVIDERS, deleteCredential, listCredentials, setCredential } from "@/server/credentials";
export const dynamic = "force-dynamic";
const P = z.enum(PROVIDERS);
export const PUT = route<{ provider: string }>(async (req, { provider }) => {
  const { secret } = z.object({ secret: z.string().min(8).max(512) }).parse(await body(req));
  await setCredential(P.parse(provider), secret);
  return { credentials: listCredentials() };
});
export const DELETE = route<{ provider: string }>(async (_req, { provider }) => {
  deleteCredential(P.parse(provider));
  return { credentials: listCredentials() };
});
