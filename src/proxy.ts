import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";
import { gateMode, SIGN_IN_PATH } from "@/lib/gate";

/**
 * The sign-in gate's first layer. Every page and API route needs a Better
 * Auth session cookie: signed-out page requests go to /sign-in?next=<path>,
 * API requests get 401. Exempt:
 *   /sign-in      so people can sign in
 *   /api/auth     the account sign-in endpoints (Better Auth)
 *   /api/mcp      assistants authenticate with their own bearer token
 *   /.well-known  the OAuth resource metadata the MCP 401 points to
 * Static assets and the favicon are excluded by the matcher below.
 *
 * This only checks that the cookie is present, without a database lookup,
 * so it is a convenience, not the security boundary: requireMember() and
 * requireOwner() in src/lib/member.ts check the session itself.
 *
 * Outside production with no Google client, everyone is the dev owner and
 * nothing is redirected. In production with sign-in not configured, nothing
 * gets through, cookie or not (see gateMode()).
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (
    pathname === SIGN_IN_PATH ||
    pathname.startsWith("/api/auth/") ||
    pathname === "/api/mcp" ||
    pathname.startsWith("/api/mcp/") ||
    pathname.startsWith("/.well-known/")
  ) {
    return NextResponse.next();
  }

  const mode = gateMode(process.env);
  if (mode === "dev-owner") return NextResponse.next();
  if (mode === "sign-in" && getSessionCookie(request)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  const signIn = new URL(SIGN_IN_PATH, request.url);
  const next = pathname + search;
  if (next !== "/") signIn.searchParams.set("next", next);
  return NextResponse.redirect(signIn);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
