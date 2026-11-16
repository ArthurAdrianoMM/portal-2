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

export const DATA_DIR_VAR = 'PORTAL2_DATA_DIR';

/** Where the server saves what it keeps between runs: the remembered sessions (docs/HOSTING.md). */
export function dataDir(env: NodeJS.ProcessEnv = process.env): string {
  return env[DATA_DIR_VAR] || join(homedir(), '.portal-2');
}
