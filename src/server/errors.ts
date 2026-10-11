export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: "BAD_REQUEST" | "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "RATE_LIMITED" | "NOT_CONFIGURED",
    public readonly status: number,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const badRequest = (msg: string) => new AppError(msg, "BAD_REQUEST", 400);
export const unauthenticated = (msg = "Please sign in.") => new AppError(msg, "UNAUTHENTICATED", 401);
export const forbidden = (msg = "You do not have permission to perform this action.") => new AppError(msg, "FORBIDDEN", 403);
/** Used for records outside the caller's scope too, so that IDs cannot be probed. */
export const notFound = (msg = "Record not found.") => new AppError(msg, "NOT_FOUND", 404);
export const conflict = (msg: string) => new AppError(msg, "CONFLICT", 409);
export const rateLimited = (msg = "Too many attempts. Please wait and try again.") => new AppError(msg, "RATE_LIMITED", 429);
export const notConfigured = (msg: string) => new AppError(msg, "NOT_CONFIGURED", 503);
