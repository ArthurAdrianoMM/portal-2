#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { isPortalError } from '../core/index.js';
import { VERSION } from '../version.js';
import { mcpCommand } from './mcp.js';
import { serveCommand } from './serve.js';

const HELP = `portal-2 ${VERSION}: seus dados do Portal do Aluno, numa API local.

Uso:
  portal-2 serve [--port 4321] [--period 2026S2]
  portal-2 mcp [--period 2026S2]

Comandos:
  serve        Serve a interface, a API (/api) e o MCP por HTTP (/mcp), em 127.0.0.1.
  mcp          Servidor MCP no stdio, para agentes de IA. Quem o inicia é o cliente MCP.

Opções:
  --port       Porta de serve (padrão: PORT, ou 4321).
  --period     Período da matrícula a usar (CODPERLET). Padrão: a matrícula mais recente.

serve: entre com usuário e senha na interface. Com PORTAL_ALUNO_USER e PORTAL_ALUNO_PASSWORD
definidos, o servidor já entra no portal ao iniciar. Com "Lembrar de mim", a sessão fica salva por
30 dias, com a senha criptografada, em PORTAL2_DATA_DIR (padrão ~/.portal-2).

Para hospedar (veja docs/HOSTING.md):
  PUBLIC_URL   O endereço que as pessoas usam, como https://portal.example.com.
               Padrão: http://127.0.0.1:<porta>.
  HOST         Onde escutar (padrão 127.0.0.1; 0.0.0.0 num contêiner).
  PORT         A porta, quando não há --port.

mcp: lê PORTAL_ALUNO_USER e PORTAL_ALUNO_PASSWORD, definidos na configuração do cliente MCP,
e entra no portal na primeira chamada de ferramenta. Veja docs/MCP.md.
`;

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

async function main(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      port: { type: 'string' },
      period: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
  });

  if (values.version) return void console.log(VERSION);
  const [command, ...extra] = positionals;
  if (values.help || command === undefined) return void console.log(HELP);
  if (extra.length > 0) fail(`Argumento a mais: ${extra.join(' ')}\n\n${HELP}`);

  switch (command) {
    case 'serve':
      return serveCommand({
        ...(values.port === undefined ? {} : { port: values.port }),
        ...(values.period === undefined ? {} : { period: values.period }),
      });
    case 'mcp': {
      if (values.port !== undefined) fail('--port vale só para serve: o servidor MCP fala pelo stdio.');
      return mcpCommand(values.period === undefined ? {} : { period: values.period });
    }
    default:
      fail(`Comando desconhecido: ${command}\n\n${HELP}`);
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  if (isPortalError(error)) console.error(`Erro [${error.code}]: ${error.message}`);
  else console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
