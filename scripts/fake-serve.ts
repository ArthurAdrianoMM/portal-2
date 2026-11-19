/**
 * Serves the real app against the in-memory fake portal (test/support), so the
 * web app can be developed without logging in to the real one. All data is made up.
 *
 *   npm run dev:fake          # web app, API and MCP on 127.0.0.1:4321
 *   npm run dev:web           # in another terminal: the web app with hot reload on localhost:5173
 *
 * Remembered sessions go to a folder in the system's temp directory, so a
 * "Lembrar de mim" login survives restarts here too.
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { createApp } from '../src/http/app.js';
import { SessionFile } from '../src/http/session-file.js';
import { Sessions } from '../src/http/sessions.js';
import { ORIGIN, PASSWORD, USER, fakeSession } from '../test/support/fake-portal.js';
import { createDemoPortal } from './demo-portal.js';

const PORT = Number(process.env.PORT ?? 4321);

const portal = createDemoPortal();
const sessions = new Sessions({
  open: (credentials) => fakeSession(portal, credentials),
  file: new SessionFile(join(tmpdir(), 'portal-2-fake', 'sessions.json')),
});

// Logged in from the start, like `serve` with the credentials in the environment.
const { token } = await sessions.login({ user: USER, password: PASSWORD });
const app = createApp({ sessions, origin: `http://127.0.0.1:${PORT}`, portalUrl: ORIGIN, log: (line) => console.error(line) });
serve({ fetch: app.fetch, hostname: '127.0.0.1', port: PORT }, () => {
  console.log(
    [
      'Portal FALSO (dados inventados), para desenvolver a interface.',
      '',
      `Página construída: http://127.0.0.1:${PORT}/#token=${token}`,
      `Com hot reload:    http://localhost:5173/#token=${token}   (rode npm run dev:web)`,
      `MCP:               http://127.0.0.1:${PORT}/mcp   (Authorization: Bearer ${token})`,
      '',
      `Para testar a tela de login: usuário ${USER}, senha ${PASSWORD}`,
    ].join('\n'),
  );
});
