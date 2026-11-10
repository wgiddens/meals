import { NextResponse, type NextRequest } from "next/server";
import { isGateEnabled, SESSION_COOKIE, verifySessionToken } from "@/lib/household";

/**
 * Household passcode gate. When HOUSEHOLD_PASSCODE is set, every page and API
 * route needs the session cookie issued by /login. Exempt:
 *   /login        so people can sign in
 *   /api/auth     the account sign-in endpoints (Better Auth)
 *   /api/mcp      assistants authenticate with their own bearer token
 *   /.well-known  the OAuth resource metadata the MCP 401 points to
 * Static assets and the favicon are excluded by the matcher below.
 */
export async function proxy(request: NextRequest) {
  if (!isGateEnabled()) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  if (
    pathname === "/login" ||
    pathname.startsWith("/api/auth/") ||
    pathname === "/api/mcp" ||
    pathname.startsWith("/api/mcp/") ||
    pathname.startsWith("/.well-known/")
  ) {
    return NextResponse.next();
  }

  if (await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value)) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Sign in to the household first" }, { status: 401 });
  }

  const login = new URL("/login", request.url);
  const next = pathname + search;
  if (next !== "/") login.searchParams.set("next", next);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
