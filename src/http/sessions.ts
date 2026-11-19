/**
 * Who is logged in to this server. Each session is opened by a token
 * `<id>.<secret>`, which the web app carries in a cookie and scripts and MCP
 * clients send as a bearer. Sessions live in memory and end after 12 hours
 * without use. Remembered ones ("Lembrar de mim") are also saved for 30 days,
 * with the credentials encrypted by their own token, and come back from the
 * file when the token is used again (docs/HOSTING.md).
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { isPortalError, type Credentials, type PortalSession, type SessionState } from '../core/index.js';
import { seal, unseal, type SavedSession, type SessionFile } from './session-file.js';

export const IDLE_MS = 12 * 60 * 60 * 1000;
export const REMEMBER_MS = 30 * 24 * 60 * 60 * 1000;

/** Creates a portal session that logs in with these credentials, and again after the portal expires it. */
export type OpenSession = (credentials: Credentials) => PortalSession;

export interface SessionsOptions {
  open: OpenSession;
  /** Where remembered sessions are saved. Read once, here. */
  file: SessionFile;
  /** For tests. */
  now?: () => number;
}

interface LiveSession {
  session: PortalSession;
  digest: Buffer;
  lastUsed: number;
}

const digestOf = (secret: Buffer) => createHash('sha256').update(secret).digest();
const same = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b);

function newToken(): { id: string; secret: Buffer; token: string } {
  const id = randomBytes(16).toString('base64url');
  const secret = randomBytes(32);
  return { id, secret, token: `${id}.${secret.toString('base64url')}` };
}

/** The id and secret of a token, or null when it has another shape. */
function parseToken(token: string | null | undefined): { id: string; secret: Buffer } | null {
  const match = /^([\w-]{22})\.([\w-]{43})$/.exec(token ?? '');
  return match ? { id: match[1]!, secret: Buffer.from(match[2]!, 'base64url') } : null;
}

export class Sessions {
  readonly #open: OpenSession;
  readonly #file: SessionFile;
  readonly #now: () => number;
  readonly #live = new Map<string, LiveSession>();
  readonly #saved: Map<string, SavedSession>;

  constructor(options: SessionsOptions) {
    this.#open = options.open;
    this.#file = options.file;
    this.#now = options.now ?? Date.now;
    this.#saved = this.#file.read();
  }

  /**
   * Logs in to the portal and opens a session; with `remember`, also saves it.
   * Nothing changes when the login fails. `expires` is set for remembered
   * sessions only; the others end after 12 hours without use.
   */
  async login(credentials: Credentials, remember = false): Promise<{ token: string; state: SessionState; expires: number | null }> {
    const session = this.#open(credentials);
    let state: SessionState;
    try {
      state = await session.login();
    } catch (error) {
      session.forget();
      throw error;
    }

    const { id, secret, token } = newToken();
    const now = this.#now();
    let expires: number | null = null;
    if (remember) {
      expires = now + REMEMBER_MS;
      this.#saved.set(id, { digest: digestOf(secret).toString('base64url'), credentials: seal(id, secret, credentials), expires });
      try {
        this.#sweep(true);
      } catch (error) {
        this.#saved.delete(id);
        session.forget();
        throw error;
      }
    } else {
      this.#sweep(false);
    }
    this.#live.set(id, { session, digest: digestOf(secret), lastUsed: now });
    return { token, state, expires };
  }

  /** Opens a session, in memory only, for a portal session that already exists. */
  add(session: PortalSession): string {
    const { id, secret, token } = newToken();
    this.#live.set(id, { session, digest: digestOf(secret), lastUsed: this.#now() });
    return token;
  }

  /** Whether this token opens a session. Never contacts the portal. */
  has(token: string | null | undefined): boolean {
    return this.#find(token) !== null;
  }

  /**
   * The portal session this token opens, logged in; null when it opens none
   * (unknown, wrong, expired or ended). When the portal refuses the
   * credentials, the session ends, so they are never sent again; that error
   * and any other from the portal pass through.
   */
  async resolve(token: string | null | undefined): Promise<PortalSession | null> {
    const found = this.#find(token);
    if (!found) return null;
    try {
      await found.session.ensureSession();
    } catch (error) {
      if (isPortalError(error, 'login_falhou')) this.#end(found.id);
      throw error;
    }
    return found.session;
  }

  /** Ends the session this token opens. False when it opens none. */
  logout(token: string | null | undefined): boolean {
    const found = this.#find(token);
    if (!found) return false;
    this.#end(found.id);
    return true;
  }

  /** The session of a valid token, from memory or, when remembered, from the file. Marks it as used. */
  #find(token: string | null | undefined): { id: string; session: PortalSession } | null {
    const parsed = parseToken(token);
    if (!parsed) return null;
    const { id, secret } = parsed;
    const digest = digestOf(secret);
    const now = this.#now();

    const saved = this.#saved.get(id);
    if (saved && saved.expires <= now) {
      this.#end(id);
      return null;
    }
    let live = this.#live.get(id);
    if (live && now - live.lastUsed > IDLE_MS) {
      live.session.forget();
      this.#live.delete(id);
      live = undefined;
    }

    if (live) {
      if (!same(live.digest, digest)) return null;
    } else {
      if (!saved || !same(Buffer.from(saved.digest, 'base64url'), digest)) return null;
      const credentials = unseal(id, secret, saved.credentials);
      if (!credentials) return null;
      live = { session: this.#open(credentials), digest, lastUsed: now };
      this.#live.set(id, live);
    }
    live.lastUsed = now;
    return { id, session: live.session };
  }

  #end(id: string): void {
    this.#live.get(id)?.session.forget();
    this.#live.delete(id);
    if (this.#saved.delete(id)) this.#file.write(this.#saved);
  }

  /** Lets go of idle sessions and expired saved ones, and saves the file when it changed or `write` asks. */
  #sweep(write: boolean): void {
    const now = this.#now();
    for (const [id, live] of this.#live) {
      if (now - live.lastUsed > IDLE_MS) {
        live.session.forget();
        this.#live.delete(id);
      }
    }
    for (const [id, saved] of this.#saved) {
      if (saved.expires <= now && this.#saved.delete(id)) write = true;
    }
    if (write) this.#file.write(this.#saved);
  }
}
