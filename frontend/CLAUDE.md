# Frontend development

Tontakery uses Angular 21 standalone components, zoneless change detection and signals, PrimeNG with the custom green Lara preset, Tailwind 4, and ngx-translate (Spanish default, English supported).

Run `npm ci`, `npm start`, and `npm run build` in this directory. `npm start` proxies `/api` to localhost:3000. See ../README.md for Docker and browser integration tests.

The root component implements login, current-round chat and paginated winners history. Authentication is server-side Google OAuth with an HttpOnly session cookie. Fetch uses same-origin credentials; writes include X-CSRF-Token from /api/auth/me. A temporary email trial login is explicitly authorized for development, gated by server configuration and disabled in production. Keep trial identities separate from verified Google accounts. Never use localStorage bearer tokens or a default admin role.

SSE events invalidate the authorized snapshot; reconnect and browser online events fetch it again. BroadcastChannel synchronizes sessions and participation across tabs. Keep anonymous authors and vote counts out of active-round responses and UI. Only winning authors are revealed after closing. Strings belong in public/i18n/es.json and en.json.

Use PrimeNG for controls. Supply explicit translated ariaLabel for buttons with icons, since decorative icon font glyphs can otherwise become part of their accessible name. Avoid automatic scrolling when new messages arrive.
