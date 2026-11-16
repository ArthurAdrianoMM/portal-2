/**
 * Browser-side state: the session with the server, and the hash route.
 *
 * The session lives in an HttpOnly cookie the server sets at login, so the
 * page never stores the token. It asks the server who is logged in, and gets
 * the token back only to show it ("Copiar token") for scripts and MCP clients.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { parseRoute, type Route } from './lib/route';

/** Where the server mounts the API (src/http/app.ts). */
export const API = '/api';

// ── Storage ─────────────────────────────────────────────────────────

/** Storage can be blocked (private mode, settings); the page then works without remembering. */
function storageGet(storage: () => Storage, key: string): string | null {
  try {
    return storage().getItem(key);
  } catch {
    return null;
  }
}
function storageSet(storage: () => Storage, key: string, value: string | null): void {
  try {
    if (value === null) storage().removeItem(key);
    else storage().setItem(key, value);
  } catch {
    // Not remembered; nothing else depends on it.
  }
}

/** Earlier versions kept the token in the browser; the cookie replaced it. */
function forgetStoredToken(): void {
  storageSet(() => localStorage, 'portal-2-token', null);
  storageSet(() => sessionStorage, 'portal-2-token', null);
}

// ── Link from the terminal ──────────────────────────────────────────

/** A token from a link the terminal printed, waiting to become this browser's cookie. */
let linkToken: string | null = null;

/**
 * When the server logs in at startup, the terminal's link carries the token in
 * the hash (`#token=…`), which never reaches the server. Take it out of the
 * address bar and keep it until the server turns it into a cookie. Runs on
 * load and on every hash change: opening the link in a tab that already shows
 * the page changes only the hash.
 */
export function captureTokenFromHash(): string | null {
  const match = /[#&]token=([^&]+)/.exec(location.hash);
  if (!match) return null;
  history.replaceState(null, '', `${location.pathname}${location.search}#/`);
  linkToken = decodeURIComponent(match[1]!);
  return linkToken;
}

// ── Connection ──────────────────────────────────────────────────────

export type ConnectionState =
  | 'verificando'
  | 'conectado'
  | 'sem_token'
  | 'token_invalido'
  | 'sessao_expirada'
  | 'somente_leitura';

type Problem = 'token_invalido' | 'sessao_expirada';

export interface Connection {
  state: ConnectionState;
  /** The session's token, to copy into scripts and MCP clients. Empty without a session. */
  token: string;
  /** The student's name, once the server confirmed the session. */
  nome: string | null;
  /** Logs in through the server. Resolves to a message for the person, or null on success. */
  login: (usuario: string, senha: string, lembrar: boolean) => Promise<string | null>;
  logout: () => void;
  /** Feeds the outcome of an API call back, so the page reflects session problems. */
  report: (errorCode: string | null) => void;
}

const SESSION_ERRORS = new Set(['sessao_expirada', 'login_falhou']);

interface ApiErrorBody {
  erro?: string;
  mensagem?: string;
  detalhes?: { mensagem: string }[];
}

interface SessionBody extends ApiErrorBody {
  token?: string;
  nome?: string;
}

/** What the server said about the session: who it is, why there is none, or nothing (it didn't answer). */
type Answer = { who: { token: string; nome: string | null }; problem: null } | { who: null; problem: Problem | null } | null;

const readJson = (res: Response): Promise<unknown> => res.json().catch(() => null);

export function errorCodeOf(body: unknown): string | null {
  return typeof body === 'object' && body !== null && 'erro' in body ? String(body.erro) : null;
}

function loginErrorMessage(body: ApiErrorBody | null, status: number): string {
  if (body?.erro === 'login_falhou') return 'O portal não aceitou o login. Confira o usuário e a senha e tente de novo.';
  if (body?.detalhes?.length) return body.detalhes.map((d) => d.mensagem).join(' ');
  return body?.mensagem ?? `O servidor respondeu HTTP ${status}.`;
}

/** Calls /api/sessao. `refused` is the problem to show when there is no session for a reason other than the portal. */
async function askSession(init: RequestInit, refused: Problem | null): Promise<Answer> {
  let res: Response;
  try {
    res = await fetch(`${API}/sessao`, { cache: 'no-store', ...init });
  } catch {
    return null;
  }
  const body = (await readJson(res)) as SessionBody | null;
  if (res.ok && typeof body?.token === 'string') return { who: { token: body.token, nome: body.nome ?? null }, problem: null };
  const code = errorCodeOf(body);
  return { who: null, problem: code !== null && SESSION_ERRORS.has(code) ? 'sessao_expirada' : refused };
}

const postJson = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json' },
  body: JSON.stringify(body),
});

/** Who is logged in, by the cookie. */
const whoIsLoggedIn = () => askSession({}, null);

/** Turns the token of a link from the terminal into this browser's cookie. */
const exchangeLinkToken = (token: string) => askSession(postJson({ token }), 'token_invalido');

export function useConnection(): Connection {
  const [serverUp, setServerUp] = useState<boolean | null>(null);
  /** The session the server confirmed; undefined until it answered. */
  const [who, setWho] = useState<{ token: string; nome: string | null } | null | undefined>(undefined);
  const [problem, setProblem] = useState<Problem | null>(null);

  const apply = useCallback((answer: Answer) => {
    if (answer === null) return setServerUp(false);
    setWho(answer.who);
    setProblem(answer.problem);
  }, []);

  useEffect(() => {
    forgetStoredToken();
    // Only this page's own server answers /health. Anywhere else (a static copy), the page is read-only.
    fetch('/health', { cache: 'no-store' })
      .then((res) => setServerUp(res.ok))
      .catch(() => setServerUp(false));
  }, []);

  // On load: the token of a link from the terminal, or else the cookie.
  useEffect(() => {
    if (!serverUp) return;
    let cancelled = false;
    const token = linkToken;
    void (token ? exchangeLinkToken(token) : whoIsLoggedIn()).then((answer) => {
      if (cancelled) return;
      if (token === linkToken) linkToken = null;
      apply(answer);
    });
    return () => {
      cancelled = true;
    };
  }, [serverUp, apply]);

  // A link opened in this tab later, or a login or logout in another tab.
  useEffect(() => {
    if (!serverUp) return;
    const onHashChange = () => {
      const token = captureTokenFromHash();
      if (!token) return;
      linkToken = null;
      void exchangeLinkToken(token).then(apply);
    };
    const onFocus = () => void whoIsLoggedIn().then(apply);
    window.addEventListener('hashchange', onHashChange);
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('hashchange', onHashChange);
      window.removeEventListener('focus', onFocus);
    };
  }, [serverUp, apply]);

  const report = useCallback((errorCode: string | null) => {
    if (errorCode === 'token_invalido') setProblem('token_invalido');
    else if (errorCode !== null && SESSION_ERRORS.has(errorCode)) setProblem('sessao_expirada');
    else if (errorCode === null) setProblem(null);
  }, []);

  const login = useCallback(async (usuario: string, senha: string, lembrar: boolean) => {
    let res: Response;
    try {
      res = await fetch(`${API}/sessao`, { ...postJson({ usuario, senha, lembrar }), cache: 'no-store' });
    } catch {
      return 'O servidor não respondeu. Ele ainda está rodando?';
    }
    const body = (await readJson(res)) as SessionBody | null;
    if (!res.ok || typeof body?.token !== 'string') return loginErrorMessage(body, res.status);
    setWho({ token: body.token, nome: body.nome ?? null });
    setProblem(null);
    return null;
  }, []);

  const logout = useCallback(() => {
    fetch(`${API}/sessao`, { method: 'DELETE' }).catch(() => {});
    setWho(null);
    setProblem(null);
  }, []);

  const state: ConnectionState =
    serverUp === null
      ? 'verificando'
      : !serverUp
        ? 'somente_leitura'
        : who === undefined
          ? 'verificando'
          : (problem ?? (who ? 'conectado' : 'sem_token'));

  return { state, token: who?.token ?? '', nome: who?.nome ?? null, login, logout, report };
}

// ── Route ───────────────────────────────────────────────────────────

export { loginHref, parseRoute, routeHref, type Route } from './lib/route';

function subscribeHash(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribeHash, () => location.hash);
  return parseRoute(hash);
}

// ── Sidebar groups ──────────────────────────────────────────────────

const CLOSED_GROUPS_KEY = 'portal-2-grupos-fechados';

function loadClosedGroups(): Set<string> {
  try {
    const saved: unknown = JSON.parse(storageGet(() => localStorage, CLOSED_GROUPS_KEY) ?? '[]');
    return new Set(Array.isArray(saved) ? saved.filter((name): name is string => typeof name === 'string') : []);
  } catch {
    return new Set();
  }
}

/** The sidebar groups the person closed, remembered in this browser. Every group starts open. */
export function useClosedGroups(): [ReadonlySet<string>, (name: string, open: boolean) => void] {
  const [closed, setClosed] = useState(loadClosedGroups);
  const setOpen = useCallback((name: string, open: boolean) => {
    setClosed((current) => {
      if (current.has(name) !== open) return current;
      const next = new Set(current);
      if (open) next.delete(name);
      else next.add(name);
      storageSet(() => localStorage, CLOSED_GROUPS_KEY, next.size ? JSON.stringify([...next]) : null);
      return next;
    });
  }, []);
  return [closed, setOpen];
}
