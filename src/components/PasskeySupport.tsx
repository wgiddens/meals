"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether this browser, on this address, can use a passkey for the site.
 *
 *   - The browser must have WebAuthn (`PublicKeyCredential`). Browsers without
 *     it get no passkey controls at all.
 *   - The page's hostname must be the passkey's domain, `rpID` (from
 *     passkeyRelyingParty() in src/lib/auth.ts), exactly. The server accepts
 *     a passkey ceremony from that one origin only, so on any other address,
 *     such as a Vercel preview's per-deployment one or 127.0.0.1 in local
 *     development, the controls are hidden rather than offered and then
 *     failing.
 *
 * False while rendering on the server and during hydration, so the controls
 * appear only once the browser has said yes and never flash on and off.
 */
export function usePasskeysAvailable(rpID: string): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => passkeysAvailable(rpID),
    () => false,
  );
}

function subscribeNever(): () => void {
  return () => {};
}

function passkeysAvailable(rpID: string): boolean {
  if (typeof window === "undefined" || typeof window.PublicKeyCredential !== "function") return false;
  return window.location.hostname.toLowerCase() === rpID.toLowerCase();
}
