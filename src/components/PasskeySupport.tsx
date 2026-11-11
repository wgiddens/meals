"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether this browser, on this address, can use a passkey for the site.
 *
 *   - The browser must have WebAuthn (`PublicKeyCredential`). Browsers without
 *     it get no passkey controls at all.
 *   - The page must be on the passkey's domain, `rpID` (from
 *     passkeyRelyingParty() in src/lib/auth.ts), or a subdomain of it. A
 *     browser refuses a passkey for any other domain, so on, say, a Vercel
 *     preview's per-deployment address the controls are hidden rather than
 *     offered and then failing.
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
  const host = window.location.hostname.toLowerCase();
  const domain = rpID.toLowerCase();
  return host === domain || host.endsWith(`.${domain}`);
}
