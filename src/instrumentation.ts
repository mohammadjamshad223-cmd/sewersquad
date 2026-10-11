import type { Instrumentation } from "next";

export async function register() {}

/** Uncaught server errors (render, route handlers, server actions) → structured log. */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { logger } = await import("@/server/logger");
  const err = error as Error & { digest?: string };
  logger.error("request_error", {
    err,
    digest: err.digest,
    method: request.method,
    path: request.path.split("?")[0],
    routePath: context.routePath,
    routeType: context.routeType,
  });
};
