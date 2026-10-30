import { describe, expect, it } from 'vitest';
import {
  hashPassword,
  newSourceToken,
  randomId,
  sha256Hex,
  timingSafeEqual,
  verifyPassword,
} from '../../src/crypto.js';

describe('crypto', () => {
  it('hashes and verifies passwords with a per-user salt', async () => {
    const a = await hashPassword('correct horse battery');
    const b = await hashPassword('correct horse battery');
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
    expect(await verifyPassword('correct horse battery', a.hash, a.salt)).toBe(true);
    expect(await verifyPassword('wrong', a.hash, a.salt)).toBe(false);
  });

  it('makes ol_ source tokens from 32 random bytes', () => {
    const token = newSourceToken();
    expect(token).toMatch(/^ol_[A-Za-z0-9_-]{43}$/);
    expect(newSourceToken()).not.toBe(token);
  });

  it('prefixes random ids', () => {
    expect(randomId('prj')).toMatch(/^prj_[a-z0-9]{16}$/);
  });

  it('computes SHA-256 hex', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('compares strings in constant time', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
  });
});
