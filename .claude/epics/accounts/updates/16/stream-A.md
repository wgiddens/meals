---
issue: 16
stream: Docs, cleanup and checks
started: 2026-11-11T03:10:19Z
status: completed
---

## Completed
- Removed the passkey placeholder: the "Passkeys … Coming soon" section on
  `/account`, the placeholder comments on `/sign-in` and in `src/lib/auth.ts`.
- Removed `@better-auth/passkey` from `package.json` and the lockfile
  (`npm uninstall`; 314 lockfile lines, the plugin and its WebAuthn deps).
- `src/db/index.ts` comment names Vercel's Neon integration and the build's
  migrate step.
- `.env.example`: passcode block removed; accounts block rewritten (dev owner,
  fail-closed, `OWNER_EMAIL` added, no automatic linking, Preview database,
  never dev against production, `VERCEL_ENV` note, pattern residual).
- `README.md`: sign-in variable table, new "Accounts" section, Neon wording,
  dev-owner warning, deploy summary pointing to `docs/DEPLOY.md`.
- `docs/ARCHITECTURE.md`: "Household passcode gate" replaced by "Accounts and
  the sign-in gate" (settings, two layers, family rules, dev owner and
  fail-closed, preview proxy and residuals); layout, stack, data model,
  checks and deployment updated.
- `docs/DEPLOY.md` (new): setup checklist and production hand check.
- `docs/PRODUCT.md`: prototype bullet replaced; accounts marked built.
- typecheck, lint, smoke (458 ok lines) and `env -u DATABASE_URL npm run build` pass.

## Working On
(none)
