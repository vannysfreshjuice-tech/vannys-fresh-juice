// The PIN lock: off until set, one PIN per person, no shared or easy PINs, waits after wrong tries.
import { beforeEach, describe, expect, it } from 'vitest';
import { memoryStorage } from './helpers';

const g = globalThis as unknown as { localStorage: unknown; sessionStorage: unknown };
beforeEach(() => {
  g.localStorage = memoryStorage();
  g.sessionStorage = memoryStorage();
});

const pin = await import('../src/lib/pinLock');

describe('PIN lock', () => {
  it('is off until a PIN is set, and the PIN says who it is', async () => {
    expect(pin.lockIsOn()).toBe(false);
    await pin.setPin('owner', '482913');
    await pin.setPin('aisha', '730215');
    expect(pin.lockIsOn()).toBe(true);
    expect(await pin.findPin('482913')).toBe('owner');
    expect(await pin.findPin('730215')).toBe('aisha');
    expect(await pin.findPin('111112')).toBeNull();
    expect(await pin.findPin('48291')).toBeNull();
  });
  it('keeps only a fingerprint, never the PIN', async () => {
    await pin.setPin('owner', '482913');
    const stored = (g.localStorage as { getItem: (k: string) => string }).getItem('vannys.pins');
    expect(stored).not.toContain('482913');
  });
  it('refuses a PIN someone else uses, a short PIN and an easy PIN', async () => {
    await pin.setPin('owner', '482913');
    await expect(pin.setPin('aisha', '482913')).rejects.toThrow(/Someone else already uses/);
    await expect(pin.setPin('aisha', '1234')).rejects.toThrow(/6 digits/);
    await expect(pin.setPin('aisha', '111111')).rejects.toThrow(/too easy/);
    await expect(pin.setPin('aisha', '123456')).rejects.toThrow(/too easy/);
    await pin.setPin('owner', '482913'); // the same person may set the same PIN again
  });
  it('a removed PIN no longer opens; removing all turns the lock off', async () => {
    await pin.setPin('owner', '482913');
    await pin.setPin('aisha', '730215');
    pin.removePin('aisha');
    expect(await pin.findPin('730215')).toBeNull();
    pin.removeAllPins();
    expect(pin.lockIsOn()).toBe(false);
  });
  it('gives 5 free wrong tries, then waits longer each time', () => {
    for (let i = 0; i < 4; i++) expect(pin.noteWrongTry()).toBe(0);
    expect(pin.noteWrongTry()).toBe(30);
    expect(pin.noteWrongTry()).toBe(60);
    expect(pin.waitSeconds()).toBeGreaterThan(55);
    pin.clearTries();
    expect(pin.waitSeconds()).toBe(0);
  });
});
