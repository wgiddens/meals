"use client";

import { useActionState } from "react";
import { signInAction, type SignInState } from "@/app/auth-actions";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState<SignInState, FormData>(signInAction, null);
  return (
    <form action={action} className="card mx-auto mt-10 max-w-sm space-y-3">
      <div>
        <h1 className="text-xl font-semibold">Household passcode</h1>
        <p className="mt-1 text-sm text-stone-500">
          Type the family passcode once and this phone stays signed in.
        </p>
      </div>
      <input type="hidden" name="next" value={next} />
      <input
        name="passcode"
        type="password"
        autoComplete="current-password"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        required
        autoFocus
        placeholder="word-word-word"
        className="input"
        aria-invalid={state?.error ? true : undefined}
      />
      {state?.error ? (
        <p className="text-sm text-red-700" role="alert">
          {state.error}
        </p>
      ) : null}
      <button className="btn btn-primary w-full" disabled={pending}>
        {pending ? "Checking…" : "Sign in"}
      </button>
    </form>
  );
}
