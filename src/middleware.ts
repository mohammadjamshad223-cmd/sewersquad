import { NextResponse, type NextRequest } from "next/server";

/**
 * Edge pre-check only: bounce unauthenticated requests for portal pages to /login.
 * Real session validation, MFA gating and authorization happen server-side in layouts,
 * pages, server actions and route handlers (Node runtime) on every request.
 */
const PROTECTED = ["/admin", "/customer", "/driver", "/account"];

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (PROTECTED.some((p) => pathname === p || pathname.startsWith(`${p}/`)) && !req.cookies.has("ss_session")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/admin/:path*", "/customer/:path*", "/driver/:path*", "/account/:path*"] };
