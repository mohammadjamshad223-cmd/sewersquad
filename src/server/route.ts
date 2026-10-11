import "server-only";
import { NextResponse } from "next/server";
import { AppError } from "./errors";
import { logger } from "./logger";

/** Wrap a route handler: maps AppError to an HTTP status and logs unexpected errors. */
export function route<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof AppError) return NextResponse.json({ error: err.message }, { status: err.status });
      logger.error("route.unhandled_error", { err });
      return NextResponse.json({ error: "Internal error" }, { status: 500 });
    }
  };
}

export function csvResponse(filename: string, rows: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return "";
    let s = String(v);
    // Neutralize spreadsheet formula injection.
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = "﻿" + rows.map((r) => r.map(esc).join(",")).join("\r\n");
  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename.replace(/[^\w.\-]/g, "_")}"`,
      "Cache-Control": "no-store",
    },
  });
}
