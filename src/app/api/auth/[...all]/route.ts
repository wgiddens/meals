import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/auth";

/**
 * Better Auth's own endpoints (sign-in, callback, session, sign-out, ...),
 * all under /api/auth. The instance is resolved per request because it needs
 * the database handle; see getAuth().
 */
export const { GET, POST } = toNextJsHandler(async (request: Request) =>
  (await getAuth()).handler(request),
);
