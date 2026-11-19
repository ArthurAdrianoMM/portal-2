import { describe, expect, it } from 'vitest';
import { serverAddress } from '../src/env.js';

describe('serverAddress', () => {
  it('is the local server when nothing is set', () => {
    expect(serverAddress({})).toEqual({ host: '127.0.0.1', port: 4321, publicUrl: 'http://127.0.0.1:4321' });
  });

  it('follows the port, from --port before PORT', () => {
    expect(serverAddress({ PORT: '5000' })).toMatchObject({ port: 5000, publicUrl: 'http://127.0.0.1:5000' });
    expect(serverAddress({ PORT: '5000' }, '6000')).toMatchObject({ port: 6000, publicUrl: 'http://127.0.0.1:6000' });
  });

  it('reads HOST and PUBLIC_URL, without a trailing slash', () => {
    expect(serverAddress({ HOST: '0.0.0.0', PUBLIC_URL: 'https://portal.example.com/' })).toEqual({
      host: '0.0.0.0',
      port: 4321,
      publicUrl: 'https://portal.example.com',
    });
    expect(serverAddress({ PUBLIC_URL: 'http://192.168.0.10:4321' }).publicUrl).toBe('http://192.168.0.10:4321');
  });

  it('rejects ports out of range', () => {
    for (const port of ['0', '65536', 'abc', '80.5', '-1']) {
      expect(() => serverAddress({ PORT: port })).toThrow(/PORT/);
      expect(() => serverAddress({}, port)).toThrow(/--port/);
    }
  });

  it('rejects a PUBLIC_URL that is not just an http(s) origin', () => {
    for (const url of ['portal.example.com', 'ftp://portal.example.com', 'https://portal.example.com/app', 'https://x.test/?a=1', 'https://u:p@x.test']) {
      expect(() => serverAddress({ PUBLIC_URL: url }), url).toThrow(/PUBLIC_URL/);
    }
  });
});
