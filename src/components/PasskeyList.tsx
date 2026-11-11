"use client";

import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { usePasskeysAvailable } from "@/components/PasskeySupport";
import { authClient } from "@/lib/auth-client";

/** One of the member's passkeys, as /account lists it. */
export type PasskeyItem = { id: string; label: string; added: string };

const MAX_NAME_LENGTH = 50;

/**
 * The member's passkeys on /account: each with its name and the date it was
 * added, a Remove button, and "Add a passkey" when this browser can use one
 * for the site (see usePasskeysAvailable()).
 *
 * Adding and removing go through Better Auth's passkey endpoints, which act
 * only on the signed-in member's own passkeys. Adding needs a recent sign-in
 * (within a day, by Google or a passkey); otherwise the member is asked to
 * sign in again first. The
 * list itself is read on the server, so after a change the page is refreshed.
 */
export function PasskeyList({ passkeys, rpID }: { passkeys: PasskeyItem[]; rpID: string }) {
  const router = useRouter();
  const available = usePasskeysAvailable(rpID);
  const deviceName = useSyncExternalStore(subscribeNever, defaultName, () => "This device");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "error" | "done"; text: string } | null>(null);

  async function add(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("add");
    setMessage(null);
    try {
      const label = (name.trim() || deviceName).slice(0, MAX_NAME_LENGTH);
      // No `name` here: the plugin would also use it as the WebAuthn user
      // name, and the device's passkey picker would then show "iPad" rather
      // than whose passkey it is. That stays the member's email; the label
      // for this list is set on the stored passkey afterwards.
      const { data, error } = await authClient.passkey.addPasskey();
      if (error || !data) {
        setMessage({ kind: "error", text: addMessage(error && "code" in error ? error.code : undefined) });
      } else {
        // If naming fails the passkey still works; the list calls it "Passkey".
        await authClient.passkey.updatePasskey({ id: data.id, name: label }).catch(() => undefined);
        setName("");
        setMessage({ kind: "done", text: "Passkey added. Next time, choose “Use a passkey” to sign in." });
        router.refresh();
      }
    } catch {
      setMessage({ kind: "error", text: addMessage(undefined) });
    }
    setBusy(null);
  }

  async function remove(item: PasskeyItem) {
    if (!window.confirm(`Remove the passkey “${item.label}”? You can still sign in with Google.`)) return;
    setBusy(item.id);
    setMessage(null);
    try {
      const { error } = await authClient.passkey.deletePasskey({ id: item.id });
      if (error) {
        setMessage({ kind: "error", text: "Couldn’t remove that passkey. Please try again." });
      } else {
        setMessage({ kind: "done", text: "Passkey removed." });
        router.refresh();
      }
    } catch {
      setMessage({ kind: "error", text: "Couldn’t remove that passkey. Please try again." });
    }
    setBusy(null);
  }

  return (
    <div className="space-y-3">
      {passkeys.length === 0 ? (
        <p className="text-sm text-stone-500">You haven&rsquo;t added a passkey yet.</p>
      ) : (
        <ul className="divide-y divide-stone-200 rounded-md border border-stone-200" aria-label="Your passkeys">
          {passkeys.map((item) => (
            <li key={item.id} className="flex items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="break-words text-sm font-medium">{item.label}</p>
                <p className="text-xs text-stone-500">Added {item.added}</p>
              </div>
              <button
                type="button"
                onClick={() => remove(item)}
                disabled={busy !== null}
                aria-label={`Remove passkey ${item.label}`}
                className="btn btn-secondary min-h-11 shrink-0"
              >
                {busy === item.id ? "Removing…" : "Remove"}
              </button>
            </li>
          ))}
        </ul>
      )}

      {available ? (
        <form onSubmit={add} className="space-y-2">
          <label htmlFor="passkey-name" className="block text-sm font-medium">
            Name this device <span className="font-normal text-stone-500">(optional)</span>
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              id="passkey-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={MAX_NAME_LENGTH}
              placeholder={deviceName}
              autoComplete="off"
              className="input min-h-11 text-base"
            />
            <button type="submit" disabled={busy !== null} className="btn btn-primary min-h-11 shrink-0">
              {busy === "add" ? "Waiting for your device…" : "Add a passkey"}
            </button>
          </div>
        </form>
      ) : null}

      {message && (
        <p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? "text-sm text-red-700" : "text-sm text-green-700"}>
          {message.text}
        </p>
      )}
    </div>
  );
}

function addMessage(code: string | undefined): string {
  switch (code) {
    case "SESSION_NOT_FRESH":
      return "For your security, adding a passkey needs a recent sign-in. Sign out, sign in again, then add it.";
    case "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED":
      return "This device already has a passkey for your account.";
    case "ERROR_CEREMONY_ABORTED":
    case "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY":
      return "The passkey wasn’t added.";
    default:
      return "Couldn’t add a passkey. Please try again.";
  }
}

/** A guess at what this device is, for the passkey's default name. */
function defaultName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android phone";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows PC";
  if (/CrOS/.test(ua)) return "Chromebook";
  return "This device";
}

function subscribeNever(): () => void {
  return () => {};
}
