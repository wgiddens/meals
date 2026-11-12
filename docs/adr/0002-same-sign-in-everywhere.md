# The same sign-in everywhere, with no dev shortcut

Local development used to skip sign-in entirely: with no Google client configured, everyone was a built-in dev Owner. We removed that shortcut, so every environment, local included, uses the same real sign-in, and when sign-in isn't configured the app is closed everywhere, not just in production. Members, the Owner and permissions are what the app increasingly depends on, so development has to exercise the real thing; the cost is a `vercel link` and `vercel env pull` before working locally.

## Consequences

- Automated browser tests can't sign in through Google; how they get a Session is decided when the first one needs it.
