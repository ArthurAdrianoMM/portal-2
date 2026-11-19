/**
 * The server: the web app at /, the API under /api, MCP at /mcp. The API
 * routes and the MCP tools are generated from the operation definitions.
 *
 * The same code runs locally and hosted; only `origin` differs
 * (docs/HOSTING.md). Routes that need a login take the session token from
 * `Authorization: Bearer` or from the session cookie. The Host check blocks
 * DNS rebinding; requests that change something must come from this server's
 * pages or from outside a browser; there are no CORS headers, so other sites
 * cannot read responses.
 */
import { createMcpHandler } from '@modelcontextprotocol/server';
import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { LocalError } from '../api/errors.js';
import { createMcpServer } from '../mcp/server.js';
import { generateOpenApi } from '../openapi/generate.js';
import {
  operations as allOperations,
  isFileOperation,
  runFileOperation,
  runOperation,
  type FileResult,
  type Operation,
} from '../operations/index.js';
import { VERSION } from '../version.js';
import { ERROR_DESCRIPTIONS, ERROR_STATUS, apiError, toApiError, type ApiError, type ApiErrorCode } from './errors.js';
import { readInput, toRoutePath } from './input.js';
import type { Sessions } from './sessions.js';
import { registerWebApp } from './web.js';

/** Where the API is mounted. Operation paths (`/notas`) are relative to it. */
export const API_PREFIX = '/api';
export const SESSION_COOKIE = 'portal2_sessao';

export interface AppOptions {
  /** Who is logged in. */
  sessions: Sessions;
  /** The address people use to reach this server, such as `http://127.0.0.1:4321`. */
  origin: string;
  /** The portal origin, shown in the OpenAPI document. */
  portalUrl: string;
  operations?: readonly Operation[];
  /** One line per request (method, path, status, time). Never query strings, bodies or tokens. */
  log?: (line: string) => void;
  /** Folder of the built web app. Defaults to dist/web. */
  webDir?: string;
}

const credentialsBodySchema = z.strictObject({
  usuario: z.string().trim().min(1, 'Informe o usuário.'),
  senha: z.string().min(1, 'Informe a senha.'),
  lembrar: z.boolean().default(false),
});

const tokenBodySchema = z.strictObject({ token: z.string().min(1, 'Informe o token.') });

/** The hosts this server answers for: its own, and `localhost` too when it is a loopback address. */
function allowedHosts(url: URL): Set<string> {
  const hosts = new Set([url.host]);
  if (url.hostname === '127.0.0.1') hosts.add(url.port ? `localhost:${url.port}` : 'localhost');
  return hosts;
}

/** The session token: the bearer of a script or MCP client, or the web app's cookie. */
function tokenOf(c: Context): string | null {
  const bearer = /^Bearer\s+(\S+)$/i.exec(c.req.header('authorization') ?? '')?.[1];
  return bearer ?? getCookie(c, SESSION_COOKIE) ?? null;
}

function sendError(c: Context, code: ApiErrorCode, body: ApiError = apiError(code)) {
  return c.json(body, ERROR_STATUS[code]);
}

/** `attachment`, with an ASCII fallback name and the real one in `filename*` (RFC 6266). */
function contentDisposition(nome: string | null): string {
  if (!nome) return 'attachment';
  const ascii = nome.normalize('NFKD').replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '_') || 'arquivo';
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nome)}`;
}

/**
 * A file from the portal, as a download. Files come from other people (the
 * school), so the browser must never run one in this origin, where the
 * session lives: always `attachment`, and a CSP that blocks everything if it
 * is opened anyway.
 */
function sendFile(c: Context, file: FileResult) {
  return c.body(file.conteudo, 200, {
    'Content-Type': file.tipo,
    'Content-Disposition': contentDisposition(file.nome),
    'Content-Security-Policy': "default-src 'none'; sandbox",
  });
}

export function createApp(options: AppOptions): Hono {
  const { sessions, log } = options;
  const operations = options.operations ?? allOperations;
  const url = new URL(options.origin);
  const secure = url.protocol === 'https:';
  const hosts = allowedHosts(url);
  const origins = new Set([...hosts].map((host) => `${url.protocol}//${host}`));
  const openApi = generateOpenApi({ serverUrl: `${url.origin}${API_PREFIX}`, portalUrl: options.portalUrl, operations });

  const setSessionCookie = (c: Context, token: string, expires: number | null) =>
    setCookie(c, SESSION_COOKIE, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
      secure,
      ...(expires === null ? {} : { expires: new Date(expires) }),
    });

  // Every MCP request gets its own server, which resolves the session from the request's token.
  const mcp = createMcpHandler(({ authInfo }) =>
    createMcpServer({
      session: async () => {
        const session = await sessions.resolve(authInfo?.token);
        if (!session) throw new LocalError('token_invalido', ERROR_DESCRIPTIONS.token_invalido);
        return session;
      },
      operations,
      ...(log ? { log } : {}),
    }),
  );

  const app = new Hono();

  app.use('*', async (c, next) => {
    const started = performance.now();
    await next();
    log?.(`${c.req.method} ${c.req.path} ${c.res.status} ${Math.round(performance.now() - started)}ms`);
  });

  app.use('*', async (c, next) => {
    if (!hosts.has(new URL(c.req.url).host)) return sendError(c, 'host_invalido');
    // Browsers always send Origin when a request changes something: only this server's pages may.
    const origin = c.req.header('origin');
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD' && origin !== undefined && !origins.has(origin)) {
      return sendError(c, 'origem_invalida');
    }
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
    if (!c.res.headers.has('Cache-Control')) c.header('Cache-Control', 'no-store');
  });

  app.get('/health', (c) => c.json({ status: 'ok', versao: VERSION }));
  app.get(`${API_PREFIX}/openapi.json`, (c) => c.json(openApi));

  // Login. The password goes from here to the portal only. It stays in this process's memory and,
  // with "lembrar", is saved encrypted by the session's own token (docs/HOSTING.md).
  app.post(`${API_PREFIX}/sessao`, async (c) => {
    if (!c.req.header('content-type')?.startsWith('application/json')) {
      return sendError(c, 'parametro_invalido', apiError('parametro_invalido', 'Envie o corpo como application/json.'));
    }
    const body: unknown = await c.req.json().catch(() => null);

    // A token from elsewhere, such as the link the terminal prints: this browser gets a cookie for it.
    if (typeof body === 'object' && body !== null && 'token' in body) {
      const { token } = tokenBodySchema.parse(body);
      const session = await sessions.resolve(token);
      if (!session) return sendError(c, 'token_invalido');
      const { user, context } = await session.ensureSession();
      setSessionCookie(c, token, null);
      return c.json({ token, nome: user.username, periodo: context.codPerLet }, 200);
    }

    const { usuario, senha, lembrar } = credentialsBodySchema.parse(body);
    const { token, state, expires } = await sessions.login({ user: usuario, password: senha }, lembrar);
    setSessionCookie(c, token, expires);
    return c.json({ token, nome: state.user.username, periodo: state.context.codPerLet }, 200);
  });

  app.get(`${API_PREFIX}/sessao`, async (c) => {
    const token = tokenOf(c);
    const session = await sessions.resolve(token);
    if (!session) return sendError(c, 'token_invalido');
    const { user, context } = await session.ensureSession();
    return c.json({ token, nome: user.username, periodo: context.codPerLet }, 200);
  });

  app.delete(`${API_PREFIX}/sessao`, (c) => {
    const ended = sessions.logout(tokenOf(c));
    deleteCookie(c, SESSION_COOKIE, { path: '/', secure });
    return ended ? c.body(null, 204) : sendError(c, 'token_invalido');
  });

  for (const operation of operations) {
    app.on(operation.method.toUpperCase(), `${API_PREFIX}${toRoutePath(operation.path)}`, async (c) => {
      const token = tokenOf(c);
      if (!sessions.has(token)) return sendError(c, 'token_invalido');
      const input = readInput(operation, c.req.param() as Record<string, string>, c.req.queries());
      const session = await sessions.resolve(token);
      if (!session) return sendError(c, 'token_invalido');
      if (isFileOperation(operation)) return sendFile(c, await runFileOperation(operation, session, input));
      return c.json(await runOperation(operation, session, input), 200);
    });
  }

  // MCP over HTTP: the same tools as `portal-2 mcp`, for the session of the token.
  app.all('/mcp', async (c) => {
    const token = tokenOf(c);
    if (token === null || !sessions.has(token)) return sendError(c, 'token_invalido');
    return mcp.fetch(c.req.raw, { authInfo: { token, clientId: 'portal-2', scopes: [] } });
  });

  registerWebApp(app, options.webDir);

  app.notFound((c) => sendError(c, 'nao_encontrado'));
  app.onError((error, c) => {
    const { status, body, internal } = toApiError(error);
    if (internal) log?.(`erro interno em ${c.req.method} ${c.req.path}: ${error.message}`);
    return c.json(body, status);
  });

  return app;
}
