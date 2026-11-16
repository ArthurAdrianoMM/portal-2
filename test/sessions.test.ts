import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SessionFile, seal, unseal } from '../src/http/session-file.js';
import { IDLE_MS, REMEMBER_MS, Sessions } from '../src/http/sessions.js';
import { PASSWORD, USER, createFakePortal, fakeSession, type FakePortal } from './support/fake-portal.js';

const HOUR = 3600 * 1000;
const CREDENTIALS = { user: USER, password: PASSWORD };

/** A session store over a fake portal, in a folder of its own, with a clock the test moves. */
function setup(portal: FakePortal = createFakePortal()) {
  const folder = mkdtempSync(join(tmpdir(), 'portal-2-sessions-'));
  const file = new SessionFile(join(folder, 'dados', 'sessions.json'));
  const clock = { now: 1_800_000_000_000 };
  // `portalPassword` stands for a password changed on the portal since the session was saved.
  const create = (portalPassword?: string) =>
    new Sessions({
      open: (credentials) => fakeSession(portal, portalPassword === undefined ? credentials : { ...credentials, password: portalPassword }),
      file,
      now: () => clock.now,
    });
  return { portal, file, folder, clock, sessions: create(), restart: create };
}

const loginAttempts = (portal: FakePortal) => portal.paths().filter((p) => p === 'POST TOTVSEducacional/Login').length;

describe('tokens', () => {
  it('opens one session per login, each with its own token', async () => {
    const { sessions } = setup();
    const first = await sessions.login(CREDENTIALS);
    const second = await sessions.login(CREDENTIALS);

    expect(first.token).toMatch(/^[\w-]{22}\.[\w-]{43}$/);
    expect(second.token).not.toBe(first.token);
    expect(await sessions.resolve(first.token)).not.toBeNull();
    expect(await sessions.resolve(second.token)).not.toBeNull();
  });

  it('opens nothing with a wrong secret, a malformed token or none', async () => {
    const { sessions } = setup();
    const { token } = await sessions.login(CREDENTIALS);
    const [id] = token.split('.');

    for (const wrong of [`${id}.${'A'.repeat(43)}`, 'abc', '', null, undefined]) {
      expect(sessions.has(wrong)).toBe(false);
      expect(await sessions.resolve(wrong)).toBeNull();
    }
  });

  it('changes nothing when the login fails', async () => {
    const { sessions, file } = setup();
    await expect(sessions.login({ user: USER, password: 'errada' }, true)).rejects.toMatchObject({ code: 'login_falhou' });
    expect(existsSync(file.path)).toBe(false);
  });
});

describe('sessions in memory', () => {
  it('end after 12 hours without use, and live on while used', async () => {
    const { sessions, clock } = setup();
    const { token } = await sessions.login(CREDENTIALS);

    clock.now += IDLE_MS - HOUR;
    expect(sessions.has(token)).toBe(true);
    clock.now += IDLE_MS - HOUR;
    expect(sessions.has(token)).toBe(true);
    clock.now += IDLE_MS + 1;
    expect(sessions.has(token)).toBe(false);
  });

  it('write nothing to disk', async () => {
    const { sessions, file } = setup();
    await sessions.login(CREDENTIALS);
    expect(existsSync(file.path)).toBe(false);
  });

  it('end on logout', async () => {
    const { sessions } = setup();
    const { token } = await sessions.login(CREDENTIALS);
    expect(sessions.logout(token)).toBe(true);
    expect(sessions.has(token)).toBe(false);
    expect(sessions.logout(token)).toBe(false);
  });
});

describe('remembered sessions', () => {
  it('are saved readable by this user only, with no user or password in clear', async () => {
    const { sessions, file } = setup();
    const { expires } = await sessions.login(CREDENTIALS, true);

    const text = readFileSync(file.path, 'utf8');
    expect(text).not.toContain(USER);
    expect(text).not.toContain(PASSWORD);
    expect(statSync(file.path).mode & 0o777).toBe(0o600);
    expect(statSync(join(file.path, '..')).mode & 0o777).toBe(0o700);
    expect(Object.values(JSON.parse(text).sessions)).toEqual([{ digest: expect.any(String), credentials: expect.any(String), expires }]);
  });

  it('come back after a restart, logging in again with the saved credentials', async () => {
    const { sessions, portal, restart } = setup();
    const { token } = await sessions.login(CREDENTIALS, true);
    const before = loginAttempts(portal);

    const restarted = restart();
    const session = await restarted.resolve(token);
    expect(session).not.toBeNull();
    expect(session!.user?.login).toBe(USER);
    expect(loginAttempts(portal)).toBe(before + 1);
  });

  it('come back from the file after 12 hours without use', async () => {
    const { sessions, clock } = setup();
    const { token } = await sessions.login(CREDENTIALS, true);
    clock.now += IDLE_MS + 1;
    expect(await sessions.resolve(token)).not.toBeNull();
  });

  it('end after 30 days, used or not, and leave the file', async () => {
    const { sessions, clock, file } = setup();
    const { token } = await sessions.login(CREDENTIALS, true);

    clock.now += REMEMBER_MS - HOUR;
    expect(sessions.has(token)).toBe(true);
    clock.now += 2 * HOUR;
    expect(sessions.has(token)).toBe(false);
    expect(file.read().size).toBe(0);
  });

  it('leave the file on logout', async () => {
    const { sessions, file, restart } = setup();
    const { token } = await sessions.login(CREDENTIALS, true);
    sessions.logout(token);

    expect(file.read().size).toBe(0);
    expect(restart().has(token)).toBe(false);
  });

  it('end when the portal refuses the saved password, which is never sent again', async () => {
    const { sessions, portal, restart, file } = setup();
    const { token } = await sessions.login(CREDENTIALS, true);

    // The password was changed on the portal: the saved one no longer works.
    const restarted = restart('trocada');
    const before = loginAttempts(portal);
    await expect(restarted.resolve(token)).rejects.toMatchObject({ code: 'login_falhou' });
    expect(await restarted.resolve(token)).toBeNull();
    expect(loginAttempts(portal)).toBe(before + 1);
    expect(file.read().size).toBe(0);
  });
});

describe('the sessions file', () => {
  it('only opens credentials with the secret and id they were sealed for', () => {
    const secret = Buffer.alloc(32, 7);
    const sealed = seal('id-a', secret, CREDENTIALS);

    expect(unseal('id-a', secret, sealed)).toEqual(CREDENTIALS);
    expect(unseal('id-a', Buffer.alloc(32, 8), sealed)).toBeNull();
    expect(unseal('id-b', secret, sealed)).toBeNull();
    const tampered = Buffer.from(sealed, 'base64url');
    tampered[20]! ^= 1;
    expect(unseal('id-a', secret, tampered.toString('base64url'))).toBeNull();
  });

  it('refuses to start from a file it cannot read, saying what to do', () => {
    const { folder } = setup();
    const path = join(folder, 'sessions.json');
    writeFileSync(path, '{ quebrado');
    expect(() => new SessionFile(path).read()).toThrow('Apague-o para começar sem sessões salvas.');
  });
});
