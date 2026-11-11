import type { AuthInfo } from "@modelcontextprotocol/server";

type Env = Readonly<Record<string, string | undefined>>;

/**
 * Bearer-token check for /api/mcp, as a pure function of the environment so
 * checks can call it. Set MCP_API_KEY and give that value to each assistant
 * as its bearer token.
 *
 * With no key, the endpoint is open outside production (local development
 * needs no setup) and refuses every request in production, so assistants
 * cannot get round the account sign-in. Undefined means refused.
 */
export function verifyMcpToken(token: string | undefined, env: Env): AuthInfo | undefined {
  const expected = env.MCP_API_KEY;
  if (!expected) {
    if (env.NODE_ENV === "production") return undefined;
    return { token: "anonymous", clientId: "local", scopes: ["household"] };
  }
  if (!token || !constantTimeEqual(token, expected)) return undefined;
  return { token, clientId: "household", scopes: ["household"] };
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
