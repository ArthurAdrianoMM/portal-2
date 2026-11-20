/**
 * Serves the web app (built from web/ into dist/web) at /. The app only loads
 * files from this server and only talks to this server.
 */
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Context, Hono } from 'hono';

/** Resolves to <repo>/dist/web both from src/http (tsx) and from dist/http (built). */
export const DEFAULT_WEB_DIR = fileURLToPath(new URL('../../dist/web/', import.meta.url));

const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  // blob: shows an image the page itself downloaded from this server (a file response).
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

const NOT_BUILT = `<!doctype html>
<html lang="pt-BR"><meta charset="utf-8"><title>Portal 2</title>
<p>A interface ainda não foi gerada. Rode <code>npm run build:web</code> e reinicie o servidor.</p>
<p>A API e o <a href="/api/openapi.json">openapi.json</a> funcionam sem ela.</p>
</html>
`;

/** The file a path names (`/` is index.html), or null when it would leave the folder. */
function resolveWebFile(root: string, requestPath: string): string | null {
  let relative: string;
  try {
    relative = decodeURIComponent(requestPath.replace(/^\//, ''));
  } catch {
    return null;
  }
  if (relative.includes('\0')) return null;
  const file = resolve(root, relative || 'index.html');
  return file.startsWith(root.endsWith(sep) ? root : root + sep) ? file : null;
}

async function sendWebFile(c: Context, file: string) {
  const type = CONTENT_TYPES[extname(file)];
  if (!type) return null;
  let body: Buffer;
  try {
    body = await readFile(file);
  } catch {
    return null;
  }
  // Files under assets/ have a content hash in their name, so they never change.
  const cache = file.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-store';
  return c.body(new Uint8Array(body), 200, {
    'Content-Type': type,
    'Cache-Control': cache,
    'Content-Security-Policy': CONTENT_SECURITY_POLICY,
  });
}

/** Register last: it answers GETs no other route took, and passes on the rest. */
export function registerWebApp(app: Hono, webDir: string = DEFAULT_WEB_DIR): void {
  const root = resolve(webDir);

  // The page used to live at /docs/; its hash routes still work at /.
  app.get('/docs', (c) => c.redirect('/'));
  app.get('/docs/*', (c) => c.redirect('/'));
  app.get('*', async (c, next) => {
    const file = resolveWebFile(root, c.req.path);
    const response = file ? await sendWebFile(c, file) : null;
    if (response) return response;
    if (c.req.path === '/') return c.html(NOT_BUILT, 503, { 'Content-Security-Policy': CONTENT_SECURITY_POLICY });
    await next();
  });
}
