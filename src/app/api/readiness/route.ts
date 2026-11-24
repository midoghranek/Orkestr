import { route } from "@/server/http";
import { readiness } from "@/server/producer";
export const dynamic = "force-dynamic";
export const GET = route(() => readiness());
