"use client";

import { useActionState, useState } from "react";
import {
  cancelInvitationAction,
  inviteMemberAction,
  removeMemberAction,
  renameFamilyAction,
  type FamilyFormState,
  type InviteFormState,
} from "@/app/family/actions";

/**
 * The owner's controls on /family. The page renders these only for the owner;
 * the actions check again with requireOwner(), so hiding them is not the
 * protection. Buttons and inputs are at least 44 px tall for thumbs.
 */

const TAP = "min-h-11 min-w-11";

/** The longest valid email address (RFC 5321); the invite action enforces it too. */
const MAX_EMAIL_LENGTH = 254;

function FormError({ id, message }: { id: string; message?: string }) {
  return (
    <p id={id} role="alert" aria-live="polite" className="text-sm text-red-700 empty:hidden">
      {message}
    </p>
  );
}

/** Invite someone by name and email, then show what to tell them. */
export function InviteForm({ appUrl }: { appUrl: string }) {
  const [state, action, pending] = useActionState<InviteFormState, FormData>(inviteMemberAction, null);
  const values = state?.values;

  return (
    <div className="space-y-3">
      <form action={action} className="space-y-3" aria-describedby="invite-error">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1">
            <span className="text-sm font-medium">Name</span>
            <input
              name="name"
              required
              maxLength={100}
              autoComplete="off"
              defaultValue={values?.name ?? ""}
              className={`input ${TAP} text-base`}
            />
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium">Google account email</span>
            <input
              name="email"
              type="email"
              required
              maxLength={MAX_EMAIL_LENGTH}
              inputMode="email"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              defaultValue={values?.email ?? ""}
              className={`input ${TAP} text-base`}
            />
          </label>
        </div>
        <FormError id="invite-error" message={state?.error} />
        <button className={`btn btn-primary ${TAP} w-full sm:w-auto`} disabled={pending}>
          {pending ? "Inviting…" : "Invite"}
        </button>
      </form>

      {state?.invited ? (
        <div role="status" className="space-y-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm">
          <p className="font-medium text-emerald-900">{state.invited.name} is invited.</p>
          <p className="text-emerald-900">
            No email is sent. Send them this address yourself:
          </p>
          <p className="rounded bg-white px-2 py-1.5 font-mono text-sm break-all select-all">{appUrl}</p>
          <p className="text-emerald-900">
            They sign in with Google using <span className="font-medium break-all">{state.invited.email}</span>.
          </p>
        </div>
      ) : null}
    </div>
  );
}

/** The family's name, with a Rename button that opens a small form. */
export function RenameFamily({ name }: { name: string }) {
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useActionState<FamilyFormState, FormData>(
    async (prev, formData) => {
      const result = await renameFamilyAction(prev, formData);
      if (!result?.error) setEditing(false);
      return result;
    },
    null,
  );

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold break-words">{name}</h1>
        <button type="button" className={`btn btn-secondary ${TAP}`} onClick={() => setEditing(true)}>
          Rename
        </button>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-2" aria-describedby="rename-error">
      <label className="block space-y-1">
        <span className="text-sm font-medium">Family name</span>
        <input
          name="name"
          required
          maxLength={100}
          autoFocus
          defaultValue={state?.values?.name ?? name}
          className={`input ${TAP} text-base`}
        />
      </label>
      <FormError id="rename-error" message={state?.error} />
      <div className="flex gap-2">
        <button className={`btn btn-primary ${TAP}`} disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="button" className={`btn btn-secondary ${TAP}`} onClick={() => setEditing(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Cancels a pending invitation. */
export function CancelInvitationButton({ invitationId, name }: { invitationId: string; name: string }) {
  const [state, action, pending] = useActionState<FamilyFormState, FormData>(cancelInvitationAction, null);
  return (
    <form action={action} className="flex flex-col items-end gap-1">
      <input type="hidden" name="invitationId" value={invitationId} />
      <button className={`btn btn-secondary ${TAP}`} disabled={pending} aria-label={`Cancel the invitation for ${name}`}>
        {pending ? "Cancelling…" : "Cancel"}
      </button>
      <FormError id={`cancel-error-${invitationId}`} message={state?.error} />
    </form>
  );
}

/** Removes a member after one confirmation. */
export function RemoveMemberButton({ memberId, name }: { memberId: string; name: string }) {
  const [confirming, setConfirming] = useState(false);
  const [state, action, pending] = useActionState<FamilyFormState, FormData>(removeMemberAction, null);

  if (!confirming) {
    return (
      <div className="flex flex-col items-end gap-1">
        <button
          type="button"
          className={`btn btn-danger ${TAP}`}
          onClick={() => setConfirming(true)}
          aria-label={`Remove ${name}`}
        >
          Remove
        </button>
        <FormError id={`remove-error-${memberId}`} message={state?.error} />
      </div>
    );
  }

  return (
    <form action={action} className="w-full space-y-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm">
      <input type="hidden" name="memberId" value={memberId} />
      <p className="text-red-900">
        Remove {name} from the family? They are signed out and can&rsquo;t sign in again unless you invite
        them.
      </p>
      <div className="flex flex-wrap gap-2">
        <button className={`btn bg-red-700 text-white hover:bg-red-600 ${TAP}`} disabled={pending}>
          {pending ? "Removing…" : `Yes, remove ${name}`}
        </button>
        <button
          type="button"
          className={`btn btn-secondary ${TAP}`}
          onClick={() => setConfirming(false)}
          disabled={pending}
        >
          Keep
        </button>
      </div>
      <FormError id={`remove-error-${memberId}`} message={state?.error} />
    </form>
  );
}
