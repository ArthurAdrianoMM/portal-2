# One server, local or hosted: design

How `portal-2 serve` grows from a local API into something that can also be hosted, for people who don't want to install anything, without becoming two programs. The MCP server's own design is in [MCP.md](MCP.md).

Hosting is an alternative, never a replacement. The local server and `npx portal-2 mcp` stay the default, and the option where the password never leaves your computer.

## Intentions

- **One server, one behavior.** Local and hosted run the same code, the same routes and the same login. What differs is configuration, never a code path.
- **One login.** Your portal user and password, on one page. No extra accounts, passwords or codes to create.
- **Clean, simple, robust.** Few moving parts, no dependency where a few lines will do, every rule in one place.
- **Easy to run.** Locally, one command. Hosted, `docker compose up -d` behind a Cloudflare Tunnel.

## Routes

| Path | What |
|---|---|
| `/` | The web app: today the API docs with "testar"; later, pages for notas, faltas and the rest. Hash routes (`#/…`). |
| `/api/sessao` | `POST` log in · `GET` who is logged in · `DELETE` log out |
| `/api/<operation>` | The operations, as `/api/notas`, `/api/disciplinas/{idTurmaDisc}/aulas`… |
| `/api/openapi.json` | The OpenAPI document. Its server URL ends in `/api`; the operation paths don't. |
| `/mcp` | MCP over HTTP (Streamable HTTP, stateless) |
| `/health` | Liveness, for Docker and monitors |
| `/docs`, `/docs/` | Redirect to `/`, for old links |

The operations keep their paths (`/notas`). The `/api` prefix lives in one place: where the routes are mounted, and the OpenAPI server URL. The web app can then own `/` and everything outside `/api`.

## Sessions

There is one kind of session, created by logging in with the portal user and password at `POST /api/sessao`.

### The token

```
<id>.<secret>      id: 16 random bytes · secret: 32 random bytes · both base64url
```

The same token travels two ways:

- **Cookie**, for the web app. `portal2_sessao`: `HttpOnly`, `SameSite=Lax`, `Path=/`, and `Secure` when the server's address is `https`. The page never stores the token itself.
- **`Authorization: Bearer`**, for scripts and MCP clients. "Copiar token" on the page gives it.

Every route that needs a login accepts either. The server keeps only a SHA-256 digest of the secret, compared in constant time.

### Lifetimes

| | In memory | Saved | Cookie |
|---|---|---|---|
| Without "Lembrar de mim" | until 12 hours without use, or a restart | never | ends with the browser |
| With "Lembrar de mim" | 12 hours without use, then reloaded from the file | 30 days from the login | 30 days |

A new login does not end the others: the web app, Claude Code and a script can each have their own. `DELETE /api/sessao` ends the session that sends it.

### "Lembrar de mim": saved with the password encrypted

A remembered session is saved to `sessions.json` in the data folder (`PORTAL2_DATA_DIR`, default `~/.portal-2`), so it survives restarts. The portal has no tokens of its own that outlive its session, so logging in again needs the password; the file keeps it encrypted:

- The key is derived from the token's secret (HKDF-SHA256, with the id as salt), and the user and password are encrypted together with AES-256-GCM, the id as additional data.
- The server keeps no key. The file holds ids, digests, dates and ciphertext; without the users' tokens it opens nothing.
- When a remembered session is used after a restart, or after 12 hours idle, the server decrypts the credentials with the token that came with the request, logs in again, and keeps the session in memory.
- The folder is created only when someone ticks "Lembrar de mim", with mode `0700`; the file is written atomically, with mode `0600`. Expired sessions are dropped whenever it is written.

What this can't protect: while the server runs, its memory holds the sessions it is using. That is the same as today.

### A refused password ends the session

If the portal refuses the saved password (it was changed), the session is deleted and the next request gets `token_invalido`: log in again. The server never sends a refused password a second time, so it can't lock the account. This is the same rule as the MCP server on stdio.

## Protections, the same everywhere

- **Host check:** the server answers only for its own address (`127.0.0.1:<port>` and `localhost:<port>` locally). This blocks DNS rebinding.
- **Origin check:** a request that changes something (any method but `GET` and `HEAD`) and comes with an `Origin` must come from this server. Browsers always send `Origin` on those, so other sites can't log you in or out, or call `/mcp` with your cookie. Clients that aren't browsers send none and pass.
- **No CORS headers:** other sites can't read responses.
- **CSP on the web app:** scripts, styles and requests only to this server, no inline code.
- **Files from the portal** are always `attachment`, with a CSP that blocks everything.
- **Logs:** method, path, status and time. No query strings, bodies, tokens or IP addresses.

## MCP over HTTP

`/mcp` serves the same tools as `portal-2 mcp`, through the SDK's stateless HTTP handler, built on the same `createMcpServer({ session })`. The route checks the token first (`401 token_invalido` without one), then each request's server resolves the session from it.

Clients that accept a header connect with the token of a session, usually a remembered one, so it lasts 30 days:

```sh
claude mcp add --transport http portal-2 http://127.0.0.1:4321/mcp --header "Authorization: Bearer <token>"
```

Claude.ai and ChatGPT only connect through OAuth, which is step 3.

## Steps

### 1. One server (done)

`/api`, the web app at `/`, sessions with the cookie and the bearer, "Lembrar de mim" with encrypted saving, and `/mcp`. Works locally right away; it is also phase 2 of [MCP.md](MCP.md).

### 2. Docker

- Configuration by environment: `PUBLIC_URL` (the address people use; drives the Host and Origin checks, the cookie's `Secure` flag, the OpenAPI server URL and later the OAuth addresses), `HOST`, `PORT`, `PORTAL2_DATA_DIR`.
- A `Dockerfile` (build stage, then `node:24-slim` with production dependencies, non-root, `HEALTHCHECK /health`) and a `compose.yaml` with the app and `cloudflared`. The data folder is a volume; no port is published.
- The Termos de uso and Política de privacidade as pages of the web app, linked from the login: "Ao entrar, você aceita os Termos".
- Cloudflare: a rate limit on the logins, and no bot challenge on `/mcp`, `/oauth/*` and `/.well-known/*`, which AI clients can't solve.

### 3. OAuth, for Claude.ai and ChatGPT

The OAuth flow ends on the same login page. `/oauth/authorize` sends people to it, or straight to "Permitir que o Claude leia seus dados do portal?" when they are already logged in; `/oauth/token` exchanges the code (PKCE S256) for an ordinary session token. Client registration through Client ID Metadata Documents and, for clients that still need it, Dynamic Client Registration. No refresh tokens at first: when the session ends, the client sends people through the same screen again.

### 4. Hardening and a small beta

Turnstile on the login, limits on failed logins per address and per user, a global cap on concurrent requests to the portal. Then a few classmates, before anyone else.

## Why this design

- **One kind of session.** The cookie, the bearer, and later OAuth all carry the same token. There is one place to check it, end it and expire it.
- **Encrypted by the token, not by a server key.** No master key to create, store, back up or rotate, and a copy of the file is useless on its own. Nothing for users to create either: the key travels inside the cookie or token they already have.
- **A JSON file, not a database.** A handful of small records, written atomically. No dependency, nothing to migrate.
- **Paths stay where they are.** The `/api` prefix is one mount point, so no operation file changed and the MCP tools are unaffected.

Rejected:

- **Separate code for hosting:** two servers drift apart, and every fix would have to be made twice.
- **A server key for the saved passwords:** one more secret to manage, and the file plus that key would open every account.
- **SQLite or Redis:** more than a few records need.
- **Refresh tokens and rotation (for now):** a second kind of token, for little gain while sessions last 30 days.
