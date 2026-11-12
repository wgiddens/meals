---
status: proposed
---

# Sign-in goes through Vercel Connect

Google sign-in used to need two Google OAuth clients (production, and previews plus localhost) and an OAuth proxy so per-branch preview URLs could sign in; moving production to `meals.giddens.app` would also have meant editing Google's redirect URIs. We decided every environment signs in through Vercel Connect's Better Auth adapter, with one Google connector attached to Production, Preview and Development, so the proxy and both clients go away and no domain or preview URL is ever registered with Google.

## Considered Options

- **Keep the OAuth proxy and two clients.** Works today, but the proxy hooks depend on Better Auth internals and every new origin means a Google console change.
- **One connector per environment.** Vercel suggests it for isolating installations; rejected because who may sign in is decided by each environment's Owner and Invitations, not by the connector.

## Consequences

- If Connect doesn't manage Google itself, we own one Google OAuth client, in the existing Google Cloud project, whose only redirect is `https://connect.vercel.com/callback`; its credentials live in the connector, not in our environment variables.
- Sign-in depends on Vercel Connect being available and on the project's Vercel OIDC token, including locally (`vercel env pull`, about 12 hours).
- Status is `proposed` until the spike confirms Google works through Connect on a preview deploy.
