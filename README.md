# Portal 2

A read-only API for your own data in the SENAI Portal do Aluno. It runs on your computer and talks to the portal with your account. No other server is involved, apart from npm: the one place it's installed and updated from.

Class project, not official, not affiliated with SENAI or FIEB. Scope and limits: [INTENT.md](INTENT.md). What the portal exposes: [ENDPOINTS.md](ENDPOINTS.md). The MCP server's design: [docs/MCP.md](docs/MCP.md). One server, local or hosted: [docs/HOSTING.md](docs/HOSTING.md).

## Status

- [x] Core client: login, context cookie, re-login on expiry, rate limit (`src/core`)
- [x] Operations: `/eu`, `/eu/foto`, `/periodos`, `/disciplinas`, `/notas`, `/faltas`, `/faltas/aulas`, `/horario`, `/aulas`, `/disciplinas/{idTurmaDisc}/aulas`, `/disciplinas/{idTurmaDisc}/aulas/{idPlanoAula}`, `/disciplinas/{idTurmaDisc}/etapas`, `/calendario`, `/grade-curricular`, `/materiais`, `/disciplinas/{idTurmaDisc}/materiais`, `/materiais/{idMaterial}/arquivo`, `/avaliacoes-institucionais` (`src/operations`)
- [x] OpenAPI 3.1 document generated from the operations ([openapi.json](openapi.json))
- [x] Server (`portal-2 serve`): the web app at `/`, the API under `/api`, MCP at `/mcp`
- [x] Web app with the API docs and "testar", built from `openapi.json` (`web/`)
- [x] Sessions in a cookie or a bearer; "Lembrar de mim" keeps one for 30 days, the password encrypted by its own token
- [x] MCP server for AI agents, over stdio (`portal-2 mcp`) and HTTP (`/mcp`). Phases: [docs/MCP.md](docs/MCP.md)
- [x] Hosting with Docker and a Cloudflare Tunnel: `docker compose up -d` ([docs/HOSTING.md](docs/HOSTING.md#running-it))
- [ ] OAuth for Claude.ai and ChatGPT ([docs/HOSTING.md](docs/HOSTING.md))

## Requirements

Node.js 22.19 or newer.

## Use

```sh
npx portal-2@latest serve
npx portal-2@latest serve --port 5000 --period 2026S1
```

`npx` downloads the package the first time and always runs the newest release. To install the `portal-2` command instead:

```sh
npm install -g portal-2       # run the same command with @latest to update
portal-2 serve
```

When a newer release is on npm, `serve` says so at startup and prints the command that updates it. `NO_UPDATE_NOTIFIER=1` turns that check off.

It prints the local address, which opens the web app. It works without an account: every endpoint, schema and example is there. To send requests with your data, click the user icon in the top right and log in with your portal user and password. Without "Lembrar de mim", the login lasts until you close the browser or the server restarts. With it, it lasts 30 days, restarts included: the session is saved in `~/.portal-2` (or `PORTAL2_DATA_DIR`), with the password encrypted by a key that only your session's token derives.

```
Rodando em http://127.0.0.1:4321/
```

Endpoints that answer for one enrollment (`/disciplinas` and its lessons, `/notas`, `/faltas`, `/faltas/aulas`, `/horario`, `/aulas`) use the most recent one, or the one given with `--period`. Pass `periodo` with a code from `/periodos` to ask about another, for example `/api/notas?periodo=2026S1`.

From other tools, log in with `POST /api/sessao` (`{"usuario": "…", "senha": "…"}` as JSON, plus `"lembrar": true` for a session that lasts 30 days) and send the returned token as `Authorization: Bearer <token>`. The web app also has a "Copiar token" button. Each login opens its own session; `DELETE /api/sessao` ends the one that sends it.

With `PORTAL_ALUNO_USER` and `PORTAL_ALUNO_PASSWORD` set, the server logs in at startup instead and prints a link that already carries the token:

```
✓ Conectado. Matrícula do período 2026S2.

Rodando em http://127.0.0.1:4321/#token=…
Token:      …
```

## Use with AI agents (MCP)

`portal-2 mcp` is an [MCP](https://modelcontextprotocol.io) server: every operation of the API becomes a tool that Claude, Codex, Cursor, VS Code and other agents can call. The client starts it on your computer; it talks to the portal with your account, like `serve`.

It reads your portal user and password from `PORTAL_ALUNO_USER` and `PORTAL_ALUNO_PASSWORD`, which the client passes to it. It starts without contacting the portal and logs in on the first tool call, so a missing variable or a wrong password shows up in the chat as an error the agent can explain. After the portal refuses the password once, it stops trying until restarted, so it can't lock your account.

The setups below run `npx -y portal-2@latest mcp`, so every time the client starts the server it gets the newest release. Without `@latest`, npx may keep a cached old version.

**Claude Desktop.** Download `portal-2-<version>.mcpb` from the [latest release](https://github.com/ArthurAdrianoMM/portal-2/releases/latest) and open it. Claude Desktop asks for the user and password and keeps the password in its secure storage. To update, open the bundle from a newer release.

**Claude Code.**

```sh
claude mcp add portal-2 -e PORTAL_ALUNO_USER=<usuário> -e PORTAL_ALUNO_PASSWORD=<senha> -- npx -y portal-2@latest mcp
```

**VS Code** (`.vscode/mcp.json`). VS Code asks for the password and keeps it in its secure storage:

```json
{
  "inputs": [
    { "type": "promptString", "id": "portal-usuario", "description": "Usuário do Portal do Aluno" },
    { "type": "promptString", "id": "portal-senha", "description": "Senha do Portal do Aluno", "password": true }
  ],
  "servers": {
    "portal-2": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "portal-2@latest", "mcp"],
      "env": { "PORTAL_ALUNO_USER": "${input:portal-usuario}", "PORTAL_ALUNO_PASSWORD": "${input:portal-senha}" }
    }
  }
}
```

**Cursor, Gemini CLI and other clients** that take an `mcpServers` JSON:

```json
{
  "mcpServers": {
    "portal-2": {
      "command": "npx",
      "args": ["-y", "portal-2@latest", "mcp"],
      "env": { "PORTAL_ALUNO_USER": "<usuário>", "PORTAL_ALUNO_PASSWORD": "<senha>" }
    }
  }
}
```

**Codex** (`~/.codex/config.toml`), also used by Codex inside the ChatGPT desktop app:

```toml
[mcp_servers.portal-2]
command = "npx"
args = ["-y", "portal-2@latest", "mcp"]
env = { PORTAL_ALUNO_USER = "<usuário>", PORTAL_ALUNO_PASSWORD = "<senha>" }
```

Add `"--period", "2026S1"` after `"mcp"` to answer about another enrollment by default.

**Over HTTP, with `serve` running.** `serve` also answers MCP at `/mcp`, for the session of a token. Log in on the web app with "Lembrar de mim", so the session lasts 30 days, and copy its token ("Copiar token"):

```sh
claude mcp add --transport http portal-2 http://127.0.0.1:4321/mcp --header "Authorization: Bearer <token>"
```

Clients that take JSON use `{"type": "http", "url": "http://127.0.0.1:4321/mcp", "headers": {"Authorization": "Bearer <token>"}}`. Logging out on the web app ends that session, for the client too.

Except for Claude Desktop and VS Code, the client keeps the password in its config file, in plain text. That file is yours, and nothing in this project writes it. ChatGPT on the web only connects to servers on the internet, so it can't use this one.

Every tool only reads. The tools say so to the client (`readOnlyHint`), so most clients run them without asking each time.

## Hosting it

The same server runs on your own machine for people who'd rather not install anything: `docker compose up -d`, behind a Cloudflare Tunnel, configured by `PUBLIC_URL` in a `.env`. No port opens to the internet. Step by step: [docs/HOSTING.md](docs/HOSTING.md#running-it).

## How the local server stays local

- It listens on `127.0.0.1` only.
- Every API route and `/mcp` need a session: the web app's cookie, or a token as `Authorization: Bearer`. `/`, `/api/openapi.json` and `/health` don't, and none of them carry personal data.
- Requests that change something (logging in or out, `/mcp`) are refused when their `Origin` is another site, so a page open in the browser can't log you in or out, or use your session. The login takes JSON only.
- It answers only when the `Host` header is `127.0.0.1:<port>` or `localhost:<port>` (or the host of `PUBLIC_URL`, when hosted), which blocks DNS-rebinding attacks.
- It sends no CORS headers, so other sites open in your browser can't read its responses.
- The web app is built into `dist/web` and served by this server, fonts included (no CDN). Its Content-Security-Policy allows scripts, styles and requests only to this server, with no inline code.
- The password goes from the page to this server and from here to the portal only. The server keeps it in memory, to log in again when the portal expires the session, and never logs it. Only "Lembrar de mim" writes it to disk: in `sessions.json` (mode `0600`), encrypted with AES-256-GCM by a key derived from that session's token, which the server doesn't keep. If the portal refuses a saved password, the session ends and the password is never sent again. Details: [docs/HOSTING.md](docs/HOSTING.md).
- The page keeps the session in an `HttpOnly` cookie, which its scripts can't read, and stores no token. A token from the startup link reaches the page in the `#hash`, which browsers never send to servers, is exchanged for the cookie and removed from the address bar.
- Files from the portal (materials, the profile photo) are sent as `attachment` with `Content-Security-Policy: default-src 'none'; sandbox`, so a file can never run as a page of this server, where the session lives. The web app allows `blob:` images only to preview a photo it downloaded itself.
- The request log has method, path, status and time. No query strings, no bodies.
- At startup it asks the npm registry for the latest version of `portal-2`, to tell you about updates. The request carries nothing but the package name, and `NO_UPDATE_NOTIFIER=1` turns it off. `mcp` never makes it.

## Development

```sh
git clone https://github.com/ArthurAdrianoMM/portal-2.git && cd portal-2
npm install
npm run serve       # builds the web app, then serves from source; npm run serve -- --port 5000 for options
npm test            # unit tests against an in-memory fake portal, no network
npm run typecheck
npm run openapi     # regenerate openapi.json after changing an operation (a test fails if you forget)
npm run build       # web app to dist/web, server to dist/
npm run pack:mcpb   # the Claude Desktop bundle, portal-2-<version>.mcpb
```

Work on the web app without logging in to the real portal:

```sh
npm run dev:fake    # the real server against the fake portal (made-up data); prints links that log you in
                    # PORT=4399 npm run dev:fake for another port
npm run dev:web     # in another terminal: the app with hot reload; open the localhost:5173 link dev:fake printed
                    # the login screen accepts the fake account: aluno.teste / s3nha&com=símbolos
```

Try the MCP tools without the real portal. The server logs in to the fake portal by itself, so the client needs no credentials:

```sh
npm run -s dev:mcp:fake                     # MCP server on stdio, made-up data; -s keeps npm's banner off stdout
npm run -s dev:mcp:fake -- --senha-errada   # the same, with a refused login
claude mcp add portal-2-fake -- npm --prefix "$PWD" run -s dev:mcp:fake
```

CI runs the typecheck, the tests and the build on every pull request. Releases are a version tag; see [docs/RELEASING.md](docs/RELEASING.md).

In the [MCP Inspector](https://github.com/modelcontextprotocol/inspector), connect to the command `npm run -s dev:mcp:fake` in this folder. Don't give the Inspector your real credentials: it saves the `env` values of stdio servers.

Run one operation against the real portal, without the server:

```sh
npm run try                                   # lists the operations
npm run try -- notas
npm run try -- listarDisciplinas '{"apenasEmCurso":true}'
npm run try -- faltas/aulas '{"de":"2026-08-01"}'
npm run try -- horario '{"incluirEncerrados":true}'
npm run try -- notas '{"periodo":"2026S1"}'
npm run try -- aulas '{"de":"2026-11-02","ate":"2026-11-06"}'
npm run try -- grade-curricular '{"situacao":"pendente"}'
npm run try -- listarAulasDaDisciplina '{"idTurmaDisc":48213}'
npm run try -- calendario '{"de":"2026-11-01","ate":"2026-11-30"}'
npm run try -- materiais
npm run try -- baixarMaterial '{"idMaterial":3150}'   # prints the file's name, type and size, not the file
npm run try -- eu
npm run try -- avaliacoes-institucionais '{"objeto":"Curso"}'
```

The output is your own data, so don't paste it anywhere public.

Map a portal endpoint before building on it. The probe prints only field names, types, string formats and counts, never values. `--values` lists the distinct values of the fields you name, for codes and enums only:

```sh
npm run probe -- TOTVSEducacional/Periodos 'TOTVSEducacional/DisciplinasAlunoPeriodoLetivo?mostraApenasDiscEmCurso=false'
npm run probe -- TOTVSEducacional/Aluno/CalendarioAluno --values EVENTTYPE,LABEL
```

## Layout

```
src/
  core/          talks to the portal
    auth.ts        login steps (ListarAlias → JSON login → AutoLoginPortal → getcurrentuser)
    context.ts     enrollment context and the context cookie
    session.ts     PortalSession: in-memory session, re-login, getData()
    http.ts        fetch + cookie jar + throttle, no automatic redirects
    tls.ts         the intermediate certificate the portal leaves out of its chain
    response.ts    status handling, envelope, schema validation
    errors.ts      PortalError and its codes
  api/           what the HTTP and MCP adapters share: error bodies, JSON Schema
  operations/    one file per endpoint of this API: docs, schemas, handler
  openapi/       builds the OpenAPI document from the operations
  http/          the server (Hono): web app, /api routes, sessions (cookie or bearer; remembered ones
                 saved encrypted), /mcp, errors (docs/HOSTING.md)
  mcp/           the MCP server: operations as tools, results, the stdio session (docs/MCP.md)
  cli/           `portal-2` command (serve, mcp) and terminal prompts
  env.ts         what the commands read from the environment: credentials, data folder
web/             the web app (React + Vite). Reads /api/openapi.json; knows nothing else about the API
  src/lib/       pure logic: spec model, Markdown subset, fields, samples, search (tested in test/web.test.ts)
  src/components/
scripts/         dev runner (try.ts), shape probe (probe.ts), openapi.json writer, fake-portal servers (fake-serve.ts,
                 fake-mcp.ts, with demo-portal.ts), Claude Desktop bundle (pack-mcpb.ts)
docs/            design notes (MCP.md, HOSTING.md, RELEASING.md)
test/            Vitest, with an in-memory fake portal (test/support) and made-up portal answers (test/fixtures)
```

### Adding an endpoint

1. Read the endpoint's section in ENDPOINTS.md. Only build on verified behavior.
2. Add `src/operations/<name>.ts` with `defineOperation`: the upstream schema (only the fields you use, types as recorded), the output schema with `.describe()` on each field, a made-up `example`, callouts for anything surprising, and the handler.
3. Register it in `src/operations/index.ts`.
4. Add a test in `test/operations.test.ts` using `academicRoute` from the fake portal.
5. Run `npm run openapi`. The route, the MCP tool, the web app and the spec update from the definition. If the operation answers for one of the demo portal's routes, add it to `scripts/demo-portal.ts`, and its required arguments to `ARGS` in `test/mcp.test.ts`.

## Rules the code follows

- Only GET requests to the API. Never `Logout` or `Contexto/Selecao`.
- The password is only sent to the configured portal origin, and the core never stores it. It's asked for through the credentials provider whenever a login is needed; the local server's provider holds it in memory for the life of the login.
- Cookies live in memory. Nothing is written to disk or logged.
- Error messages name fields and types, never values from the portal.
- If the portal refuses a request (403), the error is passed on. There is no retry another way.

## License

[MIT](LICENSE) © 2026 Arthur Adriano Mendes Machado. Unofficial: not affiliated with SENAI, FIEB or TOTVS.
