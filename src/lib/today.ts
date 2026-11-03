import { connection } from "next/server";
import { todayIso } from "./dates";

/**
 * "Today" for pages and server components. Waits for the incoming request so
 * Next.js doesn't try to bake a date into the prerendered shell.
 */
export async function today(): Promise<string> {
  await connection();
  return todayIso();
}
