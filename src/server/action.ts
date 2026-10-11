import "server-only";
import { z, type ZodTypeAny } from "zod";
import { unstable_rethrow } from "next/navigation";
import { Prisma } from "@prisma/client";
import { AppError } from "./errors";
import { logger } from "./logger";

export type ActionResult<T = unknown> =
  | { ok: true; message?: string; data?: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string[] | undefined> };

export const initialActionState: ActionResult = { ok: true };

/** Convert FormData into a plain object; repeated keys become arrays, empty strings become undefined. */
export function formDataToObject(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of fd.entries()) {
    if (key.startsWith("$ACTION")) continue;
    const v = typeof value === "string" ? (value.trim() === "" ? undefined : value) : value;
    if (key.endsWith("[]")) {
      const k = key.slice(0, -2);
      const arr = (out[k] as unknown[]) ?? [];
      if (v !== undefined) arr.push(v);
      out[k] = arr;
    } else if (key in out) {
      const prev = out[key];
      out[key] = Array.isArray(prev) ? [...prev, v] : [prev, v];
    } else {
      out[key] = v;
    }
  }
  return out;
}

export function toActionError(err: unknown): ActionResult<never> {
  unstable_rethrow(err);
  if (err instanceof AppError) return { ok: false, error: err.message };
  if (err instanceof Error && err.name === "TransitionError") return { ok: false, error: err.message };
  if (err instanceof z.ZodError) {
    return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: err.flatten().fieldErrors as Record<string, string[]> };
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    return { ok: false, error: "This record already exists (duplicate reference)." };
  }
  logger.error("action.unhandled_error", { err });
  return { ok: false, error: "Something went wrong. The error has been logged; please try again." };
}

/**
 * Wrap a server action used with useActionState. Validates FormData with a Zod schema and maps
 * known errors to user-facing messages. Authorization MUST be performed inside `handler`.
 */
export function formAction<S extends ZodTypeAny, R = unknown>(
  schema: S,
  handler: (input: z.infer<S>, fd: FormData) => Promise<ActionResult<R> | void>,
) {
  return async (_prev: ActionResult<R> | ActionResult, fd: FormData): Promise<ActionResult<R>> => {
    try {
      const parsed = schema.safeParse(formDataToObject(fd));
      if (!parsed.success) {
        return { ok: false, error: "Please correct the highlighted fields.", fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> };
      }
      const res = await handler(parsed.data, fd);
      return (res ?? { ok: true }) as ActionResult<R>;
    } catch (err) {
      return toActionError(err) as ActionResult<R>;
    }
  };
}

/** Wrap a server action called directly (not via a form). */
export async function runAction<R>(fn: () => Promise<R>): Promise<ActionResult<R>> {
  try {
    const data = await fn();
    return { ok: true, data };
  } catch (err) {
    return toActionError(err) as ActionResult<R>;
  }
}
