import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";
import { gateMode, SIGN_IN_PATH } from "@/lib/gate";
import { lookUpMember, type MemberLookup } from "@/lib/member";

/**
 * The sign-in gate. Every page and API route needs a signed-in member:
 * signed-out page requests go to /sign-in?next=<path>, API requests get 401.
 * Exempt:
 *   /sign-in      so people can sign in
 *   /api/auth     the account sign-in endpoints (Better Auth)
 *   /api/mcp      assistants authenticate with their own bearer token
 *   /.well-known  the OAuth resource metadata the MCP 401 points to
 * Static assets and the favicon are excluded by the matcher below.
 *
 * This is the real check, not a cookie-presence check: the session is looked
 * up in the database (lookUpMember), so a forged cookie, an expired
 * session and a removed member's cookie are all turned away, and pages need
 * no check of their own. A request with no session cookie at all is turned
 * away without touching the database.
 *
 * When Better Auth renews the session (about once a day) the renewed cookie
 * is passed on, so an active member's cookie keeps being extended.
 *
 * Prefetches go through the same check. They carry the page's content, so
 * skipping them would let a signed-out visitor read it.
 *
 * Proxy runs on the Node.js runtime here, the default for this Next.js
 * version, so it can reach the database the same way pages do.
 *
 * Outside production with no Google client, everyone is the dev owner and
 * nothing is redirected. In production with sign-in not configured, nothing
 * gets through, cookie or not (see gateMode()).
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (
    pathname === SIGN_IN_PATH ||
    pathname === "/spike/connect" || // THROWAWAY SPIKE debug page

    pathname.startsWith("/api/auth/") ||
    pathname === "/api/mcp" ||
    pathname.startsWith("/api/mcp/") ||
    pathname.startsWith("/.well-known/")
  ) {
    return NextResponse.next();
  }

  const mode = gateMode(process.env);
  if (mode === "dev-owner") return NextResponse.next();

  const lookup: MemberLookup =
    mode === "sign-in" && getSessionCookie(request) !== null
      ? await lookUpMember(request.headers)
      : { member: null, setCookies: [] };
  return withCookies(lookup.member ? NextResponse.next() : refuse(request), lookup.setCookies);
}

/** A redirect to sign-in for pages, 401 for API routes. */
function refuse(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }
  const signIn = new URL(SIGN_IN_PATH, request.url);
  const next = pathname + search;
  if (next !== "/") signIn.searchParams.set("next", next);
  return NextResponse.redirect(signIn);
}

/**
 * Passes Better Auth's cookies on to the browser: the renewed session cookie
 * (which getSession() only returns, it cannot set it from here), or the
 * expired one for a session that no longer exists.
 */
function withCookies(response: NextResponse, setCookies: string[]): NextResponse {
  for (const cookie of setCookies) response.headers.append("set-cookie", cookie);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
