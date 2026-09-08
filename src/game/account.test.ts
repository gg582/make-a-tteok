import { describe, it, expect, beforeEach } from 'vitest';
import {
  login,
  loadAccount,
  getStoredAccount,
  setAccountPassword,
  hashPassword,
  verifyPassword,
  createGuest,
} from './account';

describe('account authentication & password system', () => {
  const store: Record<string, string> = {};

  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    const mockStorage = {
      getItem: (key: string) => store[key] ?? null,
      setItem: (key: string, value: string) => {
        store[key] = value;
      },
      removeItem: (key: string) => {
        delete store[key];
      },
      clear: () => {
        for (const k of Object.keys(store)) delete store[k];
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).localStorage = mockStorage;
  });

  it('hashes password with salt and verifies correctly', async () => {
    const { salt, hash } = await hashPassword('Forest2301');
    expect(salt).toHaveLength(32);
    expect(hash).toHaveLength(64);

    const valid = await verifyPassword('Forest2301', salt, hash);
    expect(valid).toBe(true);

    const invalid = await verifyPassword('WrongPw', salt, hash);
    expect(invalid).toBe(false);
  });

  it('allows logging in to existing account with same name (passwordless)', async () => {
    const res1 = await login('달인떡방');
    expect(res1.success).toBe(true);
    if (!res1.success) return;
    expect(res1.account.name).toBe('달인떡방');

    // Guest returns
    const guest = createGuest();
    expect(guest.name).toBe('나그네');

    // Logging in again with same name restores the account
    const res2 = await login('달인떡방');
    expect(res2.success).toBe(true);
    if (!res2.success) return;
    expect(res2.account.name).toBe('달인떡방');
  });

  it('requires password when account has password set', async () => {
    const res1 = await login('비번떡방', false, 'Secret123');
    expect(res1.success).toBe(true);
    if (!res1.success) return;
    expect(res1.account.passwordHash).toBeDefined();

    // Trying to login without password fails
    const failNoPw = await login('비번떡방');
    expect(failNoPw.success).toBe(false);
    if (failNoPw.success) return;
    expect(failNoPw.reason).toBe('PASSWORD_REQUIRED');

    // Trying with wrong password fails
    const failWrongPw = await login('비번떡방', false, 'Wrong');
    expect(failWrongPw.success).toBe(false);
    if (failWrongPw.success) return;
    expect(failWrongPw.reason).toBe('INVALID_PASSWORD');

    // Correct password succeeds
    const succeed = await login('비번떡방', false, 'Secret123');
    expect(succeed.success).toBe(true);
  });

  it('can toggle password <-> passwordless seamlessly', async () => {
    // Start passwordless
    const res1 = await login('자유떡집');
    expect(res1.success).toBe(true);
    if (!res1.success) return;
    expect(res1.account.passwordHash).toBeUndefined();

    // Set password
    const withPw = await setAccountPassword(res1.account, 'MyPass123');
    expect(withPw.passwordHash).toBeDefined();

    // Now requires password
    const fail = await login('자유떡집');
    expect(fail.success).toBe(false);

    // Turn back to passwordless
    const noPw = await setAccountPassword(withPw, null);
    expect(noPw.passwordHash).toBeUndefined();
    expect(noPw.passwordSalt).toBeUndefined();

    // Now logs in without password again
    const succeed = await login('자유떡집');
    expect(succeed.success).toBe(true);
  });

  it('retains multiple distinct accounts in store', async () => {
    await login('가게A', false, 'pwA');
    await login('가게B', false, 'pwB');

    expect(getStoredAccount('가게A')?.name).toBe('가게A');
    expect(getStoredAccount('가게B')?.name).toBe('가게B');

    const loginA = await login('가게A', false, 'pwA');
    expect(loginA.success).toBe(true);
    expect(loadAccount()?.name).toBe('가게A');

    const loginB = await login('가게B', false, 'pwB');
    expect(loginB.success).toBe(true);
    expect(loadAccount()?.name).toBe('가게B');
  });
});
