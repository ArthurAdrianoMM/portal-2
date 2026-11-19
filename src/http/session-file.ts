/**
 * Remembered sessions on disk: `sessions.json` in the data folder. Each record
 * keeps the portal user and password encrypted with a key derived from its
 * session token's secret, which the server never stores. Without the token, a
 * record opens nothing (docs/HOSTING.md).
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { Credentials } from '../core/index.js';

const savedSessionSchema = z.object({
  /** base64url SHA-256 of the token's secret. */
  digest: z.string(),
  /** The credentials, encrypted: base64url of IV, ciphertext and tag. */
  credentials: z.string(),
  /** When the session ends, in milliseconds since the epoch. */
  expires: z.number(),
});

const fileSchema = z.object({ version: z.literal(1), sessions: z.record(z.string(), savedSessionSchema) });

export type SavedSession = z.infer<typeof savedSessionSchema>;

export class SessionFile {
  readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  /** The saved sessions, by id. None when nothing was saved yet. */
  read(): Map<string, SavedSession> {
    let text: string;
    try {
      text = readFileSync(this.path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Map();
      throw error;
    }
    let parsed: z.infer<typeof fileSchema>;
    try {
      parsed = fileSchema.parse(JSON.parse(text));
    } catch {
      throw new Error(`${this.path} não é um arquivo de sessões válido. Apague-o para começar sem sessões salvas.`);
    }
    return new Map(Object.entries(parsed.sessions));
  }

  /** Replaces the file at once (write, then rename), readable by this user only. */
  write(sessions: ReadonlyMap<string, SavedSession>): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.tmp`;
    writeFileSync(temporary, `${JSON.stringify({ version: 1, sessions: Object.fromEntries(sessions) }, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, this.path);
  }
}

const IV_BYTES = 12;
const TAG_BYTES = 16;

/** The key of one session: only its token's secret derives it, and only for its id. */
const keyFor = (id: string, secret: Buffer) => Buffer.from(hkdfSync('sha256', secret, id, 'portal-2 sessão', 32));

/** The credentials, encrypted for session `id` (AES-256-GCM, the id as additional data). */
export function seal(id: string, secret: Buffer, credentials: Credentials): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', keyFor(id, secret), iv).setAAD(Buffer.from(id));
  const plain = JSON.stringify({ user: credentials.user, password: credentials.password });
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, ciphertext, cipher.getAuthTag()]).toString('base64url');
}

const credentialsSchema = z.object({ user: z.string(), password: z.string() });

/** The credentials sealed for `id`, or null when this secret doesn't open them. */
export function unseal(id: string, secret: Buffer, sealed: string): Credentials | null {
  try {
    const data = Buffer.from(sealed, 'base64url');
    const decipher = createDecipheriv('aes-256-gcm', keyFor(id, secret), data.subarray(0, IV_BYTES)).setAAD(Buffer.from(id));
    decipher.setAuthTag(data.subarray(data.length - TAG_BYTES));
    const plain = Buffer.concat([decipher.update(data.subarray(IV_BYTES, data.length - TAG_BYTES)), decipher.final()]);
    return credentialsSchema.parse(JSON.parse(plain.toString('utf8')));
  } catch {
    return null;
  }
}
