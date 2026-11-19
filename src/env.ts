/**
 * What the commands read from the environment. The password stays in this
 * process's memory; nothing here writes it anywhere.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Credentials } from './core/index.js';

export const USER_VAR = 'PORTAL_ALUNO_USER';
export const PASSWORD_VAR = 'PORTAL_ALUNO_PASSWORD';

/** The portal credentials in the environment, or the names of the variables that are missing. */
export function readEnvCredentials(env: NodeJS.ProcessEnv = process.env): { credentials: Credentials } | { missing: string[] } {
  const user = env[USER_VAR];
  const password = env[PASSWORD_VAR];
  if (user && password) return { credentials: { user, password } };
  return { missing: [...(user ? [] : [USER_VAR]), ...(password ? [] : [PASSWORD_VAR])] };
}

export const DEFAULT_PORT = 4321;
const LOOPBACK = '127.0.0.1';

export interface ServerAddress {
  /** The interface to listen on: `127.0.0.1` by default, `0.0.0.0` in a container. */
  host: string;
  port: number;
  /** The address people use, with no trailing slash: `http://127.0.0.1:4321`, or `https://portal.example.com` when hosted. */
  publicUrl: string;
}

function parsePort(value: string, name: string): number {
  const port = Number(value);
  if (!/^\d+$/.test(value) || port < 1 || port > 65535) throw new Error(`${name} precisa ser um número entre 1 e 65535.`);
  return port;
}

/**
 * Where `serve` listens and the address people reach it at: `HOST`, `PORT`
 * (or `--port`, which wins) and `PUBLIC_URL`. Unset, it is the local server:
 * `http://127.0.0.1:4321`. `PUBLIC_URL` drives the Host and Origin checks,
 * the cookie's `Secure` flag and the OpenAPI server URL (docs/HOSTING.md).
 */
export function serverAddress(env: NodeJS.ProcessEnv = process.env, portFlag?: string): ServerAddress {
  const host = env.HOST || LOOPBACK;
  const port = portFlag !== undefined ? parsePort(portFlag, '--port') : env.PORT ? parsePort(env.PORT, 'PORT') : DEFAULT_PORT;
  if (!env.PUBLIC_URL) return { host, port, publicUrl: `http://${LOOPBACK}:${port}` };

  let url: URL;
  try {
    url = new URL(env.PUBLIC_URL);
  } catch {
    throw new Error(`PUBLIC_URL não é um endereço válido: ${env.PUBLIC_URL}`);
  }
  // The app owns its whole origin (/, /api, /mcp), so the address can't have a path.
  if (!/^https?:$/.test(url.protocol) || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new Error(`PUBLIC_URL deve ser só o endereço, como https://portal.example.com, sem caminho: ${env.PUBLIC_URL}`);
  }
  return { host, port, publicUrl: url.origin };
}

export const DATA_DIR_VAR = 'PORTAL2_DATA_DIR';

/** Where the server saves what it keeps between runs: the remembered sessions (docs/HOSTING.md). */
export function dataDir(env: NodeJS.ProcessEnv = process.env): string {
  return env[DATA_DIR_VAR] || join(homedir(), '.portal-2');
}
