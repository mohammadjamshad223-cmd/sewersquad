/** Structured JSON logging. Pipe stdout into your log drain / error monitor of choice. */
type Level = "debug" | "info" | "warn" | "error";

function write(level: Level, msg: string, ctx?: Record<string, unknown>) {
  const entry: Record<string, unknown> = { level, msg, time: new Date().toISOString(), ...ctx };
  if (ctx?.err instanceof Error) {
    entry.err = { name: ctx.err.name, message: ctx.err.message, stack: ctx.err.stack };
  }
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else if (process.env.NODE_ENV !== "test") console.log(line);
}

export const logger = {
  debug: (msg: string, ctx?: Record<string, unknown>) => process.env.LOG_LEVEL === "debug" && write("debug", msg, ctx),
  info: (msg: string, ctx?: Record<string, unknown>) => write("info", msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => write("warn", msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => write("error", msg, ctx),
};
