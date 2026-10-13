import { listEndpoint, methodNotAllowed } from "@/server/api-v1/core";
import { listCustomers } from "@/server/api-v1/resources";

export const dynamic = "force-dynamic";

/** GET /api/v1/customers — read-only; see docs/agent-api.md. */
export const GET = listEndpoint(listCustomers);
export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
