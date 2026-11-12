"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export function SpikeConnectButton({ providerId }: { providerId: string }) {
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setError(null);
    const back = `${window.location.origin}/spike/connect`;
    const { error } = await authClient.signIn.social(
      { provider: providerId, callbackURL: back, errorCallbackURL: back },
      // Keep the existing oAuthProxy out of it: it rewrites every /sign-in/social on a preview.
      { headers: { "x-skip-oauth-proxy": "1" } },
    );
    if (error) setError(JSON.stringify(error));
  }

  return (
    <div className="space-y-2">
      <button type="button" onClick={signIn} className="btn btn-secondary min-h-12 w-full">
        Sign in with Google through Vercel Connect
      </button>
      {error && <pre className="text-xs text-red-700 whitespace-pre-wrap">{error}</pre>}
    </div>
  );
}
