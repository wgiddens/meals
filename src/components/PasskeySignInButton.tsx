"use client";

import { useState } from "react";
import { usePasskeysAvailable } from "@/components/PasskeySupport";
import { authClient } from "@/lib/auth-client";

/**
 * "Use a passkey" on /sign-in: the browser asks for Face ID, a fingerprint or
 * the device's screen lock, and a passkey a member added on /account signs
 * them in without Google. Hidden where the browser can't use a passkey for
 * this site (see usePasskeysAvailable()).
 *
 * A passkey only ever signs in to the account it was added to; it never
 * creates one. A removed member's passkeys were deleted with them, so the
 * server answers "not found" for theirs.
 *
 * `next` is the safe return path the sign-in page already checked. Success is
 * followed by a full page load, so the gate in src/proxy.ts sees the new
 * session cookie.
 */
export function PasskeySignInButton({ next, rpID }: { next: string; rpID: string }) {
  const available = usePasskeysAvailable(rpID);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!available) return null;

  async function signIn() {
    setPending(true);
    setMessage(null);
    try {
      const { error } = await authClient.signIn.passkey();
      if (!error) {
        window.location.assign(next);
        return;
      }
      setMessage(signInMessage("code" in error ? error.code : undefined));
    } catch {
      setMessage(signInMessage(undefined));
    }
    setPending(false);
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={signIn}
        disabled={pending}
        className="btn btn-secondary min-h-12 w-full text-base"
      >
        <KeyMark />
        {pending ? "Waiting for your passkey…" : "Use a passkey"}
      </button>
      {message && (
        <p role="alert" className="text-sm text-red-700">
          {message}
        </p>
      )}
    </div>
  );
}

/** A fixed message for each outcome; never the raw error text. */
function signInMessage(code: string | undefined): string {
  switch (code) {
    // Closing the browser's passkey prompt arrives as NotAllowedError, which
    // @simplewebauthn passes through as ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY.
    case "AUTH_CANCELLED":
    case "ERROR_CEREMONY_ABORTED":
    case "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY":
      return "Passkey sign-in was cancelled.";
    case "PASSKEY_NOT_FOUND":
      return "That passkey isn’t on any account here. It may have been removed. Continue with Google instead.";
    default:
      return "Passkey sign-in didn’t work. Try again, or continue with Google.";
  }
}

/** A simple key outline. */
export function KeyMark() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5 shrink-0"
    >
      <circle cx="7.5" cy="15.5" r="4.5" />
      <path d="m10.7 12.3 9.8-9.8M17 6l3 3M14.5 8.5l2 2" />
    </svg>
  );
}
