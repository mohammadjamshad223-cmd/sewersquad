import { listEndpoint, methodNotAllowed } from "@/server/api-v1/core";
import { listInvoices } from "@/server/api-v1/resources";

export const dynamic = "force-dynamic";

/** GET /api/v1/invoices — read-only; see docs/agent-api.md. */
export const GET = listEndpoint(listInvoices);
export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
