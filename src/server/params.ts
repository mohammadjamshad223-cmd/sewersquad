import "server-only";
import { notFound } from "next/navigation";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

/** Await a route's params and 404 (not 500) when the id is not a UUID. */
export async function idParam(params: Promise<{ id: string }>): Promise<string> {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  return id;
}
