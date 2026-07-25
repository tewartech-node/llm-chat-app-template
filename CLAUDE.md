# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # install dependencies
npm run dev           # local dev server (wrangler dev) at http://localhost:8787
npm run cf-typegen    # regenerate worker-configuration.d.ts from wrangler.jsonc bindings
npm run check         # tsc --noEmit && wrangler deploy --dry-run — run before considering a change done
npm run deploy        # wrangler deploy
npm test              # vitest (no test files exist in the repo yet)
npx wrangler tail      # stream logs from the deployed Worker
```

There is no lint/format tooling configured (no ESLint/Prettier config in the repo).

Note: `npm run dev` and Workers AI calls hit the real Cloudflare account (via the `AI` and `DB` bindings) even in local development — there is no offline mock, and Workers AI usage incurs charges.

## Deployment

`.github/workflows/deploy.yml` runs `wrangler deploy` on every push to `main`, authenticated via the `CLOUDFLARE_API_TOKEN` repo secret. There is no CI test/lint gate — the workflow deploys directly.

## Architecture

This is a single Cloudflare Worker (`src/index.ts`, `main` in `wrangler.jsonc`) with no router library — all requests are dispatched by hand-checking `url.pathname` and `request.method` in the default `fetch` handler. Anything not under `/api/*` falls through to the `ASSETS` binding, which serves the static frontend from `public/`.

**Bindings** (`wrangler.jsonc`):
- `AI` — Workers AI, used to run the chat model and the embedding model
- `ASSETS` — static file serving from `./public`
- `DB` — D1 database `warnetworkllm-db`
- `MEMORY_INDEX` — Vectorize index `warnetworkllm-memories`, semantic store for per-user `memories` facts

The `Env` interface is hand-written in `src/types.ts` (not the generated global `Env` in `worker-configuration.d.ts`, which only declares `AI`/`ASSETS` and is stale relative to the D1 and Vectorize bindings — re-run `npm run cf-typegen` and reconcile with `src/types.ts` if bindings change).

**D1 schema** (`warnetworkllm-db`) is not tracked anywhere in this repo (no migrations directory) — it exists only as tables referenced ad hoc from `src/index.ts`: `users`, `messages`, `memories`, `shared_knowledge`, `sessions`. Any schema change has to be applied directly against the D1 database and is invisible to git history. The live database also has a `KnowledgeChunks` table (with a `TEXT` `Embedding` column) and a `password_hash`/`salt` pair on `users` that no code in this repo reads or writes — leftover from earlier work, not part of the current app.

Before the `MEMORY_INDEX` binding will work, the Vectorize index and its metadata index must exist in the Cloudflare account (Vectorize has no local simulation and isn't provisioned by `wrangler deploy`):
```bash
npx wrangler vectorize create warnetworkllm-memories --dimensions=768 --metric=cosine
npx wrangler vectorize create-metadata-index warnetworkllm-memories --property-name=username --type=string
```
The metadata index on `username` is required — without it, `MEMORY_INDEX.query()`'s `filter: { username }` (the thing that keeps one user's facts from leaking into another user's context) will fail.

**Identity model**: authentication is Google Sign-In (Google Identity Services), backed by an opaque session cookie — no more trusting a client-supplied username. The frontend runs Google's GIS button, gets back a signed ID token (JWT), and POSTs it to `/api/auth/google`. The Worker verifies it via Google's `tokeninfo` endpoint (Google checks the signature and expiry; the Worker additionally checks `aud` matches `env.GOOGLE_CLIENT_ID` and `email_verified === "true"`), then resolves a `username` via `findOrCreateUserByGoogle`: match by `google_id`, else link a pre-existing username by matching `email` (for legacy rows created before this existed), else mint a fresh username from the email's local-part (`usernameFromEmail`, deduped with a numeric suffix). A random session ID is then written to the `sessions` table (`id`, `username`, `expires_at`, 30-day TTL) and set as an `HttpOnly; Secure; SameSite=Lax` cookie. Every other `/api/*` handler calls `getSessionUsername(request, env)`, which reads that cookie and looks up the session row — this is now the *only* source of identity; nothing trusts a `?u=`/body-supplied username anymore. `POST /api/logout` deletes the session row and clears the cookie. Expired session rows are filtered out (`expires_at > datetime('now')`) but are never swept — there's no cleanup job, so `sessions` grows unbounded over time.

Using Google auth requires a Google Cloud OAuth 2.0 Web Client ID (create one in Google Cloud Console → APIs & Services → Credentials; add the deployed origin to "Authorized JavaScript origins"). It must be set in **two** places, since the public `wrangler.jsonc` var and the static frontend are separate:
- `wrangler.jsonc` → `vars.GOOGLE_CLIENT_ID` (checked against the token's `aud` claim server-side)
- `public/index.html` → the `GOOGLE_CLIENT_ID` constant in the inline `<script>` (passed to `google.accounts.id.initialize`)

Both currently hold the placeholder `REPLACE_WITH_YOUR_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com` and must be replaced with the same real Client ID before sign-in will work. The Client ID itself isn't secret (it's meant to be embedded in frontend JS), so no `wrangler secret` is needed for it.

**API endpoints** (`src/index.ts`):
- `POST /api/auth/google` — verifies a Google ID token, upserts the user, and starts a session (sets the `session` cookie)
- `POST /api/logout` — ends the current session
- `GET /api/me` — returns `{ username }` for the current session, or 401 if not signed in
- `POST /api/chat` — main chat endpoint (see streaming/memory flow below); 401 without a valid session
- `GET /api/history` — full message history for the signed-in user
- `GET /api/memories` / `POST /api/memories` — list or add facts for the signed-in user

**Chat request flow** (`handleChatRequest`):
1. Embeds the latest user message with the `EMBEDDING_MODEL_ID` model (`@cf/baai/bge-base-en-v1.5`, 768 dims) and queries `MEMORY_INDEX` for the top 8 semantically similar facts, filtered to `metadata.username === username` — this is what keeps recall private per-user and relevant to what's actually being discussed, rather than just the most recent facts. Also loads the top 5 `shared_knowledge` insights (global, ranked by `hits`/recency) from D1. Both are appended into the system prompt if not already present. Vector recall failures are caught and logged; the chat continues without memory rather than failing the request.
2. Persists the incoming user message to `messages` before calling the model.
3. Calls `env.AI.run(MODEL_ID, { messages, max_tokens: 1024, stream: true })` and `tee()`s the resulting `ReadableStream` into two branches: one is returned directly to the client as `text/event-stream` (SSE), the other is consumed server-side by `saveAssistantReply`, which parses the SSE `data:` lines, reassembles the full response, and inserts it into `messages` as the assistant turn once the stream ends. This save happens fire-and-forget (`.catch` logs only) and does not block the client response.

**Memory write path** (`handleAddMemory`, `POST /api/memories`): inserts the fact into D1's `memories` table, then embeds it and upserts `{ id: "memory:<row id>", values, metadata: { username, fact } }` into `MEMORY_INDEX` via `indexMemory`. The fact text lives in Vectorize metadata (not just D1) so a query match doesn't need a second D1 round-trip. Indexing is best-effort — a failure logs and leaves the fact in D1 but unsearchable until manually re-embedded; nothing in this repo currently calls `/api/memories` automatically (it's a manual/API-only path, not wired into the chat UI).

`MODEL_ID`, `EMBEDDING_MODEL_ID`, and `SYSTEM_PROMPT` at the top of `src/index.ts` are the primary customization points for model choice and assistant behavior.

**Frontend**: `public/index.html` is a single static file with an inline `<script>` — no build step, no bundler, no separate `chat.js`. On load it calls `GET /api/me`; a 200 means an existing session cookie is still valid and it goes straight into chat, otherwise it renders the Google Identity Services sign-in button (loaded from `accounts.google.com/gsi/client`) and waits for `handleCredentialResponse`. All `/api/*` fetches rely on the browser sending the session cookie automatically (`credentials: "same-origin"`) — no username is ever passed by the client. It loads `/api/history` on entry and renders the `/api/chat` SSE stream by parsing `data:` lines itself (mirrors the server-side parsing logic in `saveAssistantReply`).

## Known drift from README.md

`README.md` describes the original upstream Cloudflare template (a `public/chat.js` file, no persistence/identity layer, commented-out AI Gateway snippet). The actual code has since diverged significantly — it added the D1-backed identity/history/memory system described above, and there is no AI Gateway code in `src/index.ts` despite the README's customization section describing one. Trust the source over the README for current behavior.
