import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { Hono } from 'hono';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SESSION_COOKIE, createApp } from '../src/http/app.js';
import { SessionFile } from '../src/http/session-file.js';
import { Sessions } from '../src/http/sessions.js';
import { defineFileOperation, defineOperation, type Operation } from '../src/operations/index.js';
import { listarPeriodos } from '../src/operations/periodos.js';
import {
  ORIGIN,
  PASSWORD,
  USER,
  academicRoute,
  contextRoute,
  createTestSession,
  envelope,
  fakeSession,
  type FakePortalOptions,
} from './support/fake-portal.js';
import { AULAS_DISCIPLINA, PLANO_AULA } from './fixtures/aulas-disciplina.js';
import { CALENDARIO } from './fixtures/calendario.js';
import { AVALIACOES_INSTITUCIONAIS, FOTO_BASE64, INFORMACOES_PESSOAIS } from './fixtures/conta.js';
import { ETAPAS_FALTA } from './fixtures/etapas.js';
import { MATERIAIS_INSTITUCIONAIS, PDF, downloadResponse } from './fixtures/materiais.js';
import { GRADE_CURRICULAR } from './fixtures/grade-curricular.js';

const PORT = 4321;
const BASE = `http://127.0.0.1:${PORT}`;
const CONTEXT_ID = 'ctx+B/2==';

/** A stand-in for the built web app (dist/web). */
const WEB_DIR = mkdtempSync(join(tmpdir(), 'portal-2-web-'));
mkdirSync(join(WEB_DIR, 'assets'));
writeFileSync(join(WEB_DIR, 'index.html'), '<!doctype html><title>Portal 2</title>');
writeFileSync(join(WEB_DIR, 'assets', 'index-abc123.js'), 'console.log(1);');
writeFileSync(join(WEB_DIR, 'assets', 'art-abc123.webp'), 'RIFF');
writeFileSync(join(WEB_DIR, 'assets', 'art-still-abc123.png'), 'PNG');

/** A sessions file of its own, in an empty folder. */
const sessionFile = () => new SessionFile(join(mkdtempSync(join(tmpdir(), 'portal-2-data-')), 'sessions.json'));

function setup(options: FakePortalOptions = {}, operations?: readonly Operation[], webDir = WEB_DIR, loggedIn = true) {
  const { portal, session } = createTestSession({
    routes: {
      'TOTVSEducacional/Periodos': academicRoute(CONTEXT_ID, [{ CODPERLET: '2026S2', IDPERLET: 1042 }]),
      'TOTVSEducacional/DisciplinasAlunoPeriodoLetivo': academicRoute(CONTEXT_ID, []),
      ...options.routes,
    },
  });
  const file = sessionFile();
  const sessions = new Sessions({ open: (credentials) => fakeSession(portal, credentials), file });
  const token = loggedIn ? sessions.add(session) : 'nenhum';
  const logs: string[] = [];
  const app = createApp({
    sessions,
    origin: BASE,
    portalUrl: ORIGIN,
    log: (line) => logs.push(line),
    webDir,
    ...(operations === undefined ? {} : { operations }),
  });
  const request = (path: string, init: RequestInit = {}, base = BASE) => app.request(`${base}${path}`, init);
  const authed = (path: string, init: RequestInit = {}, base = BASE) =>
    request(path, { ...init, headers: { authorization: `Bearer ${token}`, ...init.headers } }, base);
  const login = (body: unknown, headers: Record<string, string> = {}) =>
    request('/api/sessao', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: BASE, ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  return { app, portal, sessions, file, token, logs, request, authed, login };
}

describe('authentication', () => {
  it('rejects API calls without the token', async () => {
    const res = await setup().request('/api/periodos');
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ erro: 'token_invalido' });
  });

  it('rejects a wrong token', async () => {
    const res = await setup().request('/api/periodos', { headers: { authorization: 'Bearer outro' } });
    expect(res.status).toBe(401);
  });

  it('accepts the token', async () => {
    const res = await setup().authed('/api/periodos');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ periodos: [{ codigo: '2026S2', id: 1042, selecionado: true }] });
  });

  it('does not log in to the portal for a request without the token', async () => {
    const { request, portal } = setup();
    await request('/api/periodos');
    expect(portal.requests).toHaveLength(0);
  });

  it('serves health, the OpenAPI document and the web app without the token', async () => {
    const { request } = setup();
    expect((await request('/health')).status).toBe(200);
    expect((await request('/')).status).toBe(200);
    const doc = await (await request('/api/openapi.json')).json();
    expect(doc).toMatchObject({ servers: [{ url: `${BASE}/api` }] });
  });
});

describe('login', () => {
  it('logs in with the portal credentials and returns a token that opens the API, next to the other sessions', async () => {
    const { login, request, token } = setup();
    const res = await login({ usuario: USER, senha: PASSWORD });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string };
    expect(body).toEqual({ token: expect.stringMatching(/^[\w-]{22}\.[\w-]{43}$/), nome: 'Aluno Teste', periodo: '2026S2' });

    const bearer = (value: string) => ({ headers: { authorization: `Bearer ${value}` } });
    expect((await request('/api/periodos', bearer(body.token))).status).toBe(200);
    expect((await request('/api/periodos', bearer(token))).status).toBe(200);
  });

  it('starts with nobody logged in when there is no initial session', async () => {
    const { request } = setup({}, undefined, WEB_DIR, false);
    expect((await request('/api/sessao')).status).toBe(401);
    expect((await request('/api/periodos', { headers: { authorization: 'Bearer nenhum' } })).status).toBe(401);
  });

  it('reports wrong credentials and keeps the current login', async () => {
    const { login, authed } = setup();
    const res = await login({ usuario: USER, senha: 'errada' });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ erro: 'login_falhou' });
    expect((await authed('/api/periodos')).status).toBe(200);
  });

  it('refuses a login from another origin, without contacting the portal', async () => {
    const { login, portal } = setup({}, undefined, WEB_DIR, false);
    const res = await login({ usuario: USER, senha: PASSWORD }, { origin: 'https://site.test' });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ erro: 'origem_invalida' });
    expect(portal.requests).toHaveLength(0);
  });

  it('accepts a login from localhost and from clients that send no Origin', async () => {
    const { login, request } = setup();
    expect((await login({ usuario: USER, senha: PASSWORD }, { origin: `http://localhost:${PORT}` })).status).toBe(200);
    const res = await request('/api/sessao', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ usuario: USER, senha: PASSWORD }),
    });
    expect(res.status).toBe(200);
  });

  it('only takes a JSON body, naming missing fields', async () => {
    const { login } = setup();
    const form = await login(`usuario=${USER}&senha=x`, { 'content-type': 'application/x-www-form-urlencoded' });
    expect(form.status).toBe(400);
    const empty = await login({ usuario: ' ', senha: '' });
    expect(empty.status).toBe(400);
    const body = (await empty.json()) as { detalhes: { campo: string }[] };
    expect(body.detalhes.map((d) => d.campo)).toEqual(['usuario', 'senha']);
  });

  it('never logs the body', async () => {
    const { login, logs } = setup();
    await login({ usuario: USER, senha: PASSWORD });
    expect(logs.at(-1)).toMatch(/^POST \/api\/sessao 200 \d+ms$/);
    expect(logs.join('\n')).not.toContain(PASSWORD);
  });

  it('tells who is logged in', async () => {
    const { authed, request, token } = setup();
    const res = await authed('/api/sessao');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ token, nome: 'Aluno Teste', periodo: '2026S2' });
    expect((await request('/api/sessao')).status).toBe(401);
  });

  it('logs out, after which the token no longer works', async () => {
    const { authed } = setup();
    expect((await authed('/api/sessao', { method: 'DELETE' })).status).toBe(204);
    expect((await authed('/api/periodos')).status).toBe(401);
    expect((await authed('/api/sessao', { method: 'DELETE' })).status).toBe(401);
  });
});

describe('local-only protections', () => {
  it('rejects any Host other than the local address (DNS rebinding)', async () => {
    const res = await setup().authed('/api/periodos', {}, `http://attacker.test:${PORT}`);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ erro: 'host_invalido' });
  });

  it('accepts localhost as the Host', async () => {
    const res = await setup().request('/health', {}, `http://localhost:${PORT}`);
    expect(res.status).toBe(200);
  });

  it('sends no CORS headers, even to a cross-origin request', async () => {
    const res = await setup().authed('/api/periodos', { headers: { origin: 'https://site.test' } });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('logs method, path and status, never the query string', async () => {
    const { authed, logs } = setup();
    await authed('/api/disciplinas?apenasEmCurso=true');
    expect(logs.at(-1)).toMatch(/^GET \/api\/disciplinas 200 \d+ms$/);
  });
});

describe('web app', () => {
  it('serves the app at / with a CSP that only allows this server, and no inline code', async () => {
    const res = await setup().request('/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("style-src 'self'");
    expect(csp).not.toContain('unsafe');
  });

  it('sends the old /docs links to /', async () => {
    const { request } = setup();
    for (const path of ['/docs', '/docs/', '/docs/assets/index-abc123.js']) {
      const res = await request(path);
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe('/');
    }
  });

  it('serves hashed assets as cacheable, and the page as not', async () => {
    const { request } = setup();
    const asset = await request('/assets/index-abc123.js');
    expect(asset.status).toBe(200);
    expect(asset.headers.get('content-type')).toContain('javascript');
    expect(asset.headers.get('cache-control')).toContain('immutable');
    expect((await request('/')).headers.get('cache-control')).toBe('no-store');
    expect((await request('/assets/art-abc123.webp')).headers.get('content-type')).toBe('image/webp');
    expect((await request('/assets/art-still-abc123.png')).headers.get('content-type')).toBe('image/png');
  });

  it('never serves files outside the app folder, and answers what is not there with a JSON 404', async () => {
    const { request } = setup();
    for (const path of ['/..%2F..%2Fpackage.json', '/%2e%2e/%2e%2e/package.json', '/assets/nada.js', '/nada']) {
      const res = await request(path);
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ erro: 'nao_encontrado' });
    }
  });

  it('explains how to build the app when it is missing', async () => {
    const res = await setup({}, undefined, join(WEB_DIR, 'nao-existe')).request('/');
    expect(res.status).toBe(503);
    expect(await res.text()).toContain('npm run build:web');
  });
});

describe('sessions', () => {
  const cookieOf = (res: Response) => res.headers.get('set-cookie') ?? '';
  const withCookie = (token: string): RequestInit => ({ headers: { cookie: `${SESSION_COOKIE}=${token}` } });

  it('gives the browser an HttpOnly cookie that opens the API, ending with the browser', async () => {
    const { login, request } = setup({}, undefined, WEB_DIR, false);
    const res = await login({ usuario: USER, senha: PASSWORD });
    const { token } = (await res.json()) as { token: string };
    const cookie = cookieOf(res);
    expect(cookie).toContain(`${SESSION_COOKIE}=${token}`);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).not.toMatch(/Expires|Max-Age|Secure/i);
    expect((await request('/api/periodos', withCookie(token))).status).toBe(200);
  });

  it('remembers a session for 30 days, saved encrypted, across a restart', async () => {
    const { login, portal, file } = setup({}, undefined, WEB_DIR, false);
    const res = await login({ usuario: USER, senha: PASSWORD, lembrar: true });
    const { token } = (await res.json()) as { token: string };
    const expires = Date.parse(/Expires=([^;]+)/i.exec(cookieOf(res))?.[1] ?? '');
    expect(expires - Date.now()).toBeGreaterThan(29 * 24 * 3600 * 1000);

    const saved = readFileSync(file.path, 'utf8');
    expect(saved).not.toContain(PASSWORD);
    expect(saved).not.toContain(USER);

    // The same file, read by a new server.
    const restarted = createApp({
      sessions: new Sessions({ open: (credentials) => fakeSession(portal, credentials), file: new SessionFile(file.path) }),
      origin: BASE,
      portalUrl: ORIGIN,
      webDir: WEB_DIR,
    });
    const again = await restarted.request(`${BASE}/api/sessao`, withCookie(token));
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ nome: 'Aluno Teste' });
  });

  it('logs out, clearing the cookie', async () => {
    const { request, token } = setup();
    const res = await request('/api/sessao', { method: 'DELETE', ...withCookie(token) });
    expect(res.status).toBe(204);
    expect(cookieOf(res)).toMatch(new RegExp(`${SESSION_COOKIE}=;.*Max-Age=0`, 'i'));
    expect((await request('/api/periodos', withCookie(token))).status).toBe(401);
  });

  it('turns a token from elsewhere (the link the terminal prints) into a cookie', async () => {
    const { login, token } = setup();
    const res = await login({ token });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ token, nome: 'Aluno Teste', periodo: '2026S2' });
    expect(cookieOf(res)).toContain(`${SESSION_COOKIE}=${token}`);

    const wrong = await login({ token: 'nada' });
    expect(wrong.status).toBe(401);
    expect(cookieOf(wrong)).toBe('');
  });

  it('refuses changes from another site, and still lets them read nothing', async () => {
    const { request, authed, token } = setup();
    const res = await request('/api/sessao', { method: 'DELETE', headers: { origin: 'https://site.test', cookie: `${SESSION_COOKIE}=${token}` } });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ erro: 'origem_invalida' });
    expect((await authed('/api/periodos')).status).toBe(200);
  });
});

describe('MCP over HTTP', () => {
  async function connect(app: Hono, headers: Record<string, string>, era: 'legacy' | 'modern' = 'legacy') {
    const transport = new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), {
      fetch: async (url, init) => app.request(String(url), init),
      requestInit: { headers },
    });
    const client = new Client({ name: 'teste', version: '0' }, era === 'modern' ? { versionNegotiation: { mode: { pin: '2026-07-28' } } } : {});
    await client.connect(transport);
    return client;
  }

  it('refuses /mcp without a session, without contacting the portal', async () => {
    const { request, portal } = setup();
    const res = await request('/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ erro: 'token_invalido' });
    expect(portal.requests).toHaveLength(0);
  });

  it('refuses /mcp from another site\'s page', async () => {
    const { authed } = setup();
    const res = await authed('/mcp', { method: 'POST', headers: { origin: 'https://site.test', 'content-type': 'application/json' }, body: '{}' });
    expect(res.status).toBe(403);
  });

  for (const era of ['legacy', 'modern'] as const) {
    it(`serves the tools for the session of the bearer (${era} client)`, async () => {
      const { app, token, portal } = setup();
      const client = await connect(app, { authorization: `Bearer ${token}` }, era);
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name)).toContain('listarPeriodos');
      expect(portal.requests).toHaveLength(0);

      const result = await client.callTool({ name: 'listarPeriodos', arguments: {} });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual({ periodos: [{ codigo: '2026S2', id: 1042, selecionado: true }] });
    });
  }
});

describe('input', () => {
  it('converts query strings to the declared types', async () => {
    const { authed, portal } = setup();
    expect((await authed('/api/disciplinas?apenasEmCurso=true')).status).toBe(200);
    const sent = portal.requests.at(-1)!.url.searchParams.get('mostraApenasDiscEmCurso');
    expect(sent).toBe('true');
  });

  it('rejects a value of the wrong type, naming the field', async () => {
    const res = await setup().authed('/api/disciplinas?apenasEmCurso=sim');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ erro: 'parametro_invalido', detalhes: [{ campo: 'apenasEmCurso' }] });
  });

  it('rejects unknown parameters', async () => {
    const res = await setup().authed('/api/notas?semestre=2026S1');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ erro: 'parametro_invalido', detalhes: [{ campo: 'semestre' }] });
  });

  it('answers for the period asked, and 404 for one the account does not have', async () => {
    const { authed, portal } = setup({
      routes: { 'TOTVSEducacional/NotaEtapa': contextRoute({ [CONTEXT_ID]: { Notas: [] }, 'ctx+A/1==': { Notas: [] } }) },
    });
    const res = await authed('/api/notas?periodo=2026S1');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ periodo: '2026S1', disciplinas: [] });
    expect(portal.cookiesOf(portal.requests.at(-1)!).get('EduContextoAlunoResponsavelAPI')).toBe('ctx+A/1==');

    const missing = await authed('/api/notas?periodo=1999S1');
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ erro: 'periodo_inexistente' });
  });

  it('serves a nested path and keeps dates as text', async () => {
    const { authed, portal } = setup({
      routes: { 'TOTVSEducacional/Aluno/Falta/Aula': academicRoute(CONTEXT_ID, { SFREQUENCIAALUNO: [] }) },
    });
    const res = await authed('/api/faltas/aulas?de=2026-08-01&ate=2026-10-29&idTurmaDisc=48213');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ periodo: '2026S2', de: '2026-08-01', ate: '2026-10-29', faltas: [] });
    expect(portal.requests.at(-1)!.url.searchParams.get('tipoFrequencia')).toBe('A');
  });

  it('reports a date window that ends before it starts on the field', async () => {
    const res = await setup().authed('/api/faltas/aulas?de=2026-10-29&ate=2026-10-01');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ erro: 'parametro_invalido', detalhes: [{ campo: 'de' }] });
  });
});

describe('errors', () => {
  it('passes a portal refusal on as 403', async () => {
    const res = await setup({ routes: { 'TOTVSEducacional/Periodos': academicRoute('outro-id', []) } }).authed('/api/periodos');
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ erro: 'portal_recusou' });
  });

  it('includes the portal messages when there are any', async () => {
    const route = () =>
      envelope({ 'RMException:Message': 'x' }, [{ type: 'warning', detail: 'Usuário sem permissão para acessar os dados acadêmicos do aluno' }]);
    const res = await setup({ routes: { 'TOTVSEducacional/Periodos': route } }).authed('/api/periodos');
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ erro: 'sem_contexto', mensagensDoPortal: [{ tipo: 'warning' }] });
  });

  it('answers unknown routes with a JSON 404', async () => {
    const res = await setup().authed('/api/nada');
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ erro: 'nao_encontrado' });
  });

  it('hides internal error details from the response', async () => {
    const broken = defineOperation({
      ...listarPeriodos,
      handler: async () => {
        throw new Error('detalhe interno');
      },
    });
    const { authed, logs } = setup({}, [broken]);
    const res = await authed('/api/periodos');
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toMatchObject({ erro: 'erro_interno' });
    expect(JSON.stringify(body)).not.toContain('detalhe interno');
    expect(logs.some((line) => line.includes('detalhe interno'))).toBe(true);
  });
});

describe('endpoints end to end', () => {
  it('GET /aulas: lessons of a window, with the context ID the portal needs', async () => {
    const lesson = {
      IDHORARIOTURMA: 90121, DIASEMANA: 3, HORAINICIAL: '18:30', HORAFINAL: '19:20', PREDIO: null, BLOCO: null, SALA: null,
      DATA: '2026-11-03T00:00:00', AULA: 21, IDTURMADISC: 48213, CONTEUDO: 'Rotas.', CONTEUDOEFETIVO: null, LICAOCASA: null,
      CODTURMA: 'DS-2026-A', CODDISC: 'PW2', NOMEDISC: 'Programação Web II', CODSUBTURMA: '', CONFIRMADO: 'N',
      IDPLANOAULA: 7310452, TIPOAULA: 'T', URLAULAONLINE: null, OBSERVACAO: null,
    };
    const { authed, portal } = setup({
      routes: { 'TOTVSEducacional/v1/planoaulas/aulas': academicRoute(CONTEXT_ID, { SPlanoAula: [lesson], SPLANOAULAARQUIVO: [] }) },
    });

    const res = await authed('/api/aulas?de=2026-11-03&ate=2026-11-06');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { aulas: Record<string, unknown>[] };
    expect(body).toMatchObject({ periodo: '2026S2', de: '2026-11-03', ate: '2026-11-06' });
    expect(body.aulas).toEqual([expect.objectContaining({ idPlanoAula: 7310452, dia: 'terca', tipo: { codigo: 'T', descricao: 'Aula teórica' } })]);
    const call = portal.requests.find((r) => r.url.pathname.endsWith('v1/planoaulas/aulas'))!;
    expect(call.url.searchParams.get('idContextoAluno')).toBe(CONTEXT_ID);

    const tooLong = await authed('/api/aulas?de=2026-01-01&ate=2026-03-01');
    expect(tooLong.status).toBe(400);
    expect(await tooLong.json()).toMatchObject({ erro: 'parametro_invalido', detalhes: [{ campo: 'ate' }] });
  });

  it('GET /grade-curricular: the grade by group, filtered by situation', async () => {
    const { authed } = setup({
      routes: { 'TOTVSEducacional/GradeCurricular/EnsinoSuperior': academicRoute(CONTEXT_ID, GRADE_CURRICULAR) },
    });
    const res = await authed('/api/grade-curricular?situacao=em_curso');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { grupos: { codigo: number; disciplinas: { codigo: string }[] }[] };
    expect(body).toMatchObject({ periodo: '2026S2', curso: { codigo: 'DS' }, cargaHoraria: { curso: 1200 } });
    expect(body.grupos.map((g) => [g.codigo, g.disciplinas.map((d) => d.codigo)])).toEqual([[2, ['PW2']]]);

    const wrong = await authed('/api/grade-curricular?situacao=todas');
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toMatchObject({ erro: 'parametro_invalido', detalhes: [{ campo: 'situacao' }] });
  });

  it('GET /disciplinas/{idTurmaDisc}/aulas and /aulas/{idPlanoAula}: path parameters, typed and checked', async () => {
    const { authed } = setup({
      routes: {
        'TOTVSEducacional/DisciplinasAlunoPeriodoLetivo': academicRoute(CONTEXT_ID, [
          { IDTURMADISC: 48213, CODDISC: 'PW2', NOME: 'Programação Web II', CODTURMA: 'DS-2026-A', CODSUBTURMA: null, IDPERLET: 1042, CODSTATUS: 20, DESCRICAO: 'Matriculado' },
        ]),
        'TOTVSEducacional/AulasDisciplina/48213': academicRoute(CONTEXT_ID, AULAS_DISCIPLINA),
        'TOTVSEducacional/PlanoAula/Aula': academicRoute(CONTEXT_ID, PLANO_AULA),
      },
    });

    const list = await authed('/api/disciplinas/48213/aulas?de=2026-11-02&ate=2026-11-08');
    expect(list.status).toBe(200);
    expect(await list.json()).toMatchObject({ idTurmaDisc: 48213, dias: [{ data: '2026-11-03' }, { data: '2026-11-05' }] });

    const one = await authed('/api/disciplinas/48213/aulas/7310021');
    expect(one.status).toBe(200);
    expect(await one.json()).toMatchObject({ aula: { idPlanoAula: 7310021, realizada: { inicio: '18:30' } } });

    const notANumber = await authed('/api/disciplinas/pw2/aulas');
    expect(notANumber.status).toBe(400);
    expect(await notANumber.json()).toMatchObject({ erro: 'parametro_invalido', detalhes: [{ campo: 'idTurmaDisc' }] });

    const otherClass = await authed('/api/disciplinas/1/aulas');
    expect(otherClass.status).toBe(404);
    expect(await otherClass.json()).toMatchObject({ erro: 'item_inexistente' });
  });

  it('GET /calendario: a window of the whole calendar, one portal call', async () => {
    const { authed, portal } = setup({ routes: { 'TOTVSEducacional/Aluno/CalendarioAluno': academicRoute(CONTEXT_ID, CALENDARIO) } });
    const res = await authed('/api/calendario?de=2026-11-03&ate=2026-11-03&tipo=aula');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ de: '2026-11-03', ate: '2026-11-03', eventos: [{ id: 0 }, { id: 1 }] });
    expect(portal.paths().filter((p) => p.endsWith('CalendarioAluno'))).toHaveLength(1);

    const unknown = await authed('/api/calendario?periodo=2026S1');
    expect(unknown.status).toBe(400);
  });

  it('GET /disciplinas/{idTurmaDisc}/etapas: grade and absence stages of one class', async () => {
    const { authed } = setup({
      routes: {
        'TOTVSEducacional/DisciplinasAlunoPeriodoLetivo': academicRoute(CONTEXT_ID, [
          { IDTURMADISC: 48213, CODDISC: 'PW2', NOME: 'Programação Web II', CODTURMA: 'DS-2026-A', CODSUBTURMA: null, IDPERLET: 1042, CODSTATUS: 20, DESCRICAO: 'Matriculado' },
        ]),
        'TOTVSEducacional/EtapasTurmaDisc': academicRoute(CONTEXT_ID, ETAPAS_FALTA),
      },
    });
    const res = await authed('/api/disciplinas/48213/etapas?tipo=falta');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ idTurmaDisc: 48213, etapas: [{ codigo: 0, tipo: 'falta', frequenciaMinima: 75 }] });
    expect((await authed('/api/disciplinas/48213/etapas?tipo=prova')).status).toBe(400);
  });

  it('serves a file operation as a sandboxed download', async () => {
    const pdf = defineFileOperation({
      ...listarPeriodos,
      id: 'baixarTeste',
      path: '/teste/arquivo',
      file: { mediaTypes: ['application/pdf'], description: 'Um PDF.' },
      handler: async () => ({ nome: 'Calendário 2026.pdf', tipo: 'application/pdf', conteudo: new Uint8Array([0x25, 0x50, 0x44, 0x46]) }),
    });
    const { authed } = setup({}, [pdf]);
    const res = await authed('/api/teste/arquivo');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toBe(`attachment; filename="Calendario 2026.pdf"; filename*=UTF-8''Calend%C3%A1rio%202026.pdf`);
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
  });

  it('GET /materiais and /materiais/{idMaterial}/arquivo: list, then download as a sandboxed attachment', async () => {
    const { authed } = setup({
      routes: {
        'TOTVSEducacional/Material/Institucional': academicRoute(CONTEXT_ID, MATERIAIS_INSTITUCIONAIS),
        'TOTVSEducacional/Material': academicRoute(CONTEXT_ID, []),
        'TOTVSEducacional/Material/Download': () => downloadResponse(),
      },
    });
    const list = await authed('/api/materiais');
    expect(list.status).toBe(200);
    const { materiais } = (await list.json()) as { materiais: { idMaterial: number }[] };
    expect(materiais.map((m) => m.idMaterial)).toEqual([3201, 3150]);

    const res = await authed('/api/materiais/3150/arquivo');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toContain("filename*=UTF-8''Calend%C3%A1rio%20acad%C3%AAmico%202026%20(vers%C3%A3o%202).pdf");
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'; sandbox");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PDF);

    const missing = await authed('/api/materiais/1/arquivo');
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ erro: 'item_inexistente' });
  });

  it('GET /eu, /eu/foto and /avaliacoes-institucionais', async () => {
    const { authed } = setup({
      routes: {
        'TOTVSEducacional/Aluno/InformacoesPessoaisBasicas': academicRoute(CONTEXT_ID, INFORMACOES_PESSOAIS),
        'TOTVSEducacional/AvaliacoesInstitucionais': academicRoute(CONTEXT_ID, AVALIACOES_INSTITUCIONAIS),
      },
    });
    const eu = await authed('/api/eu');
    expect(eu.status).toBe(200);
    expect(await eu.json()).toMatchObject({ nome: 'Aluno Teste da Silva', login: USER, temFoto: true, matricula: { periodo: '2026S2' } });

    const foto = await authed('/api/eu/foto');
    expect(foto.status).toBe(200);
    expect(foto.headers.get('content-type')).toBe('image/png');
    expect(foto.headers.get('content-disposition')).toContain('attachment; filename="foto.png"');
    expect(new Uint8Array(await foto.arrayBuffer())).toEqual(new Uint8Array(Buffer.from(FOTO_BASE64, 'base64')));

    const avaliacoes = await authed('/api/avaliacoes-institucionais?objeto=Professor');
    expect(avaliacoes.status).toBe(200);
    expect(await avaliacoes.json()).toMatchObject({ avaliacoes: [{ id: 0, objeto: 'Professor' }] });
  });
});
