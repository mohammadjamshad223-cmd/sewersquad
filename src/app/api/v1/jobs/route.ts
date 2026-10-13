import { listEndpoint, methodNotAllowed } from "@/server/api-v1/core";
import { listJobs } from "@/server/api-v1/resources";

export const dynamic = "force-dynamic";

/** GET /api/v1/jobs — read-only; see docs/agent-api.md. */
export const GET = listEndpoint(listJobs);
export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
