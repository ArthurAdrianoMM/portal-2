import { join } from 'node:path';
import { serve, type ServerType } from '@hono/node-server';
import { DEFAULT_CONFIG, PortalSession, type Credentials, type PortalConfig } from '../core/index.js';
import { createApp } from '../http/app.js';
import { SessionFile } from '../http/session-file.js';
import { Sessions } from '../http/sessions.js';
import { PASSWORD_VAR, USER_VAR, dataDir, readEnvCredentials, serverAddress } from '../env.js';
import { PACKAGE_NAME, VERSION } from '../version.js';
import { checkForUpdate, updateHint } from './update-check.js';

export interface ServeOptions {
  /** `--port`, as typed. Wins over `PORT`. */
  port?: string;
  /** Period code of the enrollment to use (`CODPERLET`). */
  period?: string;
}

function listen(app: ReturnType<typeof createApp>, host: string, port: number): Promise<ServerType> {
  return new Promise((resolve, reject) => {
    const server = serve({ fetch: app.fetch, hostname: host, port }, () => resolve(server));
    server.once('error', (error: NodeJS.ErrnoException) => {
      reject(
        error.code === 'EADDRINUSE'
          ? new Error(`A porta ${port} já está em uso. Escolha outra com --port.`)
          : error,
      );
    });
  });
}

/** `PORTAL_ALUNO_USER` and `PORTAL_ALUNO_PASSWORD`, when both are set; `null` when neither is. */
export function envCredentials(env: NodeJS.ProcessEnv = process.env): Credentials | null {
  const read = readEnvCredentials(env);
  if ('credentials' in read) return read.credentials;
  if (read.missing.length === 2) return null;
  throw new Error(`Defina ${USER_VAR} e ${PASSWORD_VAR} juntos, ou nenhum dos dois.`);
}

/**
 * `portal-2 serve`: serves the web app, the API and MCP over HTTP, on
 * 127.0.0.1 unless `HOST` says otherwise. Login happens in the web app, or at
 * startup when the credentials are in the environment.
 */
export async function serveCommand(options: ServeOptions): Promise<void> {
  const { host, port, publicUrl } = serverAddress(process.env, options.port);
  const config: Partial<PortalConfig> = options.period === undefined ? {} : { codPerLet: options.period };
  const folder = dataDir();
  // The password stays in this process's memory, so a session can log in again after the portal
  // expires it; with "Lembrar de mim", it is also saved encrypted (docs/HOSTING.md).
  const sessions = new Sessions({
    open: (credentials: Credentials) => new PortalSession({ credentials: async () => credentials, config }),
    file: new SessionFile(join(folder, 'sessions.json')),
  });

  const fromEnv = envCredentials();
  let initial: { token: string; period: string } | undefined;
  if (fromEnv) {
    console.log('Entrando no portal…');
    const { token, state } = await sessions.login(fromEnv);
    initial = { token, period: state.context.codPerLet };
  }

  const app = createApp({
    sessions,
    origin: publicUrl,
    portalUrl: config.baseUrl ?? DEFAULT_CONFIG.baseUrl,
    log: (line) => console.error(line),
  });
  const server = await listen(app, host, port);
  const url = `${publicUrl}/`;
  // When hosted, the address people use isn't where the process listens: show both.
  const listening = publicUrl === `http://${host}:${port}` ? '' : ` (escutando em ${host}:${port})`;

  const lines = initial
    ? [
        `✓ Conectado. Matrícula do período ${initial.period}.`,
        '',
        `Rodando em ${url}#token=${initial.token}${listening}`,
        `Token:      ${initial.token}`,
      ]
    : [`Rodando em ${url}${listening}`];
  console.log(
    [
      ...lines,
      `MCP:        ${url}mcp`,
      '',
      'As sessões ficam na memória deste processo. Com "Lembrar de mim", ficam salvas por 30 dias,',
      `com a senha criptografada, em ${folder}. Ctrl+C encerra o servidor.`,
    ].join('\n'),
  );

  void checkForUpdate(PACKAGE_NAME, VERSION).then((latest) => {
    if (latest) console.log(`\nNova versão disponível: ${latest} (esta é a ${VERSION}). Atualize com: ${updateHint(PACKAGE_NAME)}`);
  });

  const stop = () => {
    server.close();
    process.exit(0);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
