/**
 * PS login / SSO unit tests (launch-prep, Showdown area #3).
 *
 * Covers the security- and protocol-critical pure helpers in
 * `src/lib/ps-login.ts`:
 *   - RSA assertion format + signature verifiability against the public key
 *   - challstr keyid-prefix stripping (assertion must sign the raw challenge)
 *   - sid-cookie comma encoding (Chrome silently drops raw-comma cookie values
 *     — there was a prior production incident; see MEMORY/project_sso_cookie_encoding)
 *   - sid round-trip set→parse, expiry, tamper rejection
 *   - cookie domain/SameSite/Secure flags by NODE_ENV
 *
 * ── Approach ──────────────────────────────────────────────────────────────────
 * `getPrivateKey()` caches the key on first read, so we set PS_RSA_PRIVATE_KEY
 * from the repo's dev keypair BEFORE importing the module. We verify signatures
 * with the matching public key the same way the PS game server does
 * (createVerify('RSA-SHA1') over the tokenData block).
 *
 * No app DB rows are required for the assertion-format and cookie tests; the
 * `getAssertionExtras` DB read just returns null for unknown userids and the
 * signer falls back to empty s-fields.
 */
import { beforeAll, describe, expect, test } from 'bun:test';
import { createVerify } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const PRIV_PEM = readFileSync(
  resolve(import.meta.dir, '../../showdown/ps_private.pem'),
  'utf-8',
);
const PUB_PEM = readFileSync(
  resolve(import.meta.dir, '../../showdown/ps_public.pem'),
  'utf-8',
);

// Must be set before the module is imported (getPrivateKey caches).
process.env.PS_RSA_PRIVATE_KEY = PRIV_PEM;
process.env.PS_HOSTNAME = 'cannoli.live';
process.env.PS_KEY_ID = '4';

const m = await import('../src/lib/ps-login');
const {
  signAssertion, toUserid, getKeyId,
  createPsSession, validatePsSid, destroyPsSession,
  parsePsSid, psSidCookieString, clearPsSidCookieString,
} = m;

/** Verify an assertion the way the PS game server does. */
function verifyAssertion(assertion: string): boolean {
  const idx = assertion.lastIndexOf(';');
  const tokenData = assertion.slice(0, idx);
  const sigHex = assertion.slice(idx + 1);
  const verify = createVerify('RSA-SHA1');
  verify.update(tokenData);
  return verify.verify(PUB_PEM, sigHex, 'hex');
}

describe('toUserid', () => {
  test('lowercases and strips non-alnum (PS convention)', () => {
    expect(toUserid('ROA_Bio')).toBe('roabio');
    expect(toUserid('Gabrys24!')).toBe('gabrys24');
    expect(toUserid('  Spaced Name  ')).toBe('spacedname');
  });
});

describe('signAssertion', () => {
  test('produces a `tokenData;signature` shape verifiable by the public key', () => {
    const challstr = '4|abc123challengehex';
    const assertion = signAssertion(challstr, 'roabio');
    expect(assertion).toBeTruthy();
    expect(assertion!.includes(';')).toBe(true);
    expect(verifyAssertion(assertion!)).toBe(true);
  });

  test('signs the raw challenge, NOT the keyid-prefixed challstr', () => {
    // PS strips the "keyid|" prefix and stores only the challenge; the
    // assertion must therefore embed the bare challenge. If the signer
    // mistakenly signed "4|abc..." the game server's verify (over "abc...")
    // would fail.
    const challenge = 'deadbeefchallenge';
    const assertion = signAssertion(`4|${challenge}`, 'roabio')!;
    const tokenData = assertion.slice(0, assertion.lastIndexOf(';'));
    const firstField = tokenData.split(',')[0];
    expect(firstField).toBe(challenge);
    expect(firstField.includes('|')).toBe(false);
  });

  test('tokenData carries the documented 8 comma-separated fields', () => {
    // challenge,userid,usertype,timestamp,hostname,s1,s2,s3
    const assertion = signAssertion('4|chal', 'someunknownuser')!;
    const tokenData = assertion.slice(0, assertion.lastIndexOf(';'));
    const fields = tokenData.split(',');
    expect(fields.length).toBe(8);
    expect(fields[0]).toBe('chal');
    expect(fields[1]).toBe('someunknownuser');
    expect(fields[2]).toBe('2'); // default usertype
    expect(Number.isFinite(parseInt(fields[3], 10))).toBe(true);
    expect(fields[4]).toBe('cannoli.live');
    // Unknown user → empty s-fields.
    expect(fields[5]).toBe('');
    expect(fields[6]).toBe('');
    expect(fields[7]).toBe('');
  });

  test('handles a challstr with no keyid prefix gracefully', () => {
    const assertion = signAssertion('barechallengeonly', 'roabio')!;
    expect(verifyAssertion(assertion)).toBe(true);
    const firstField = assertion.split(',')[0];
    expect(firstField).toBe('barechallengeonly');
  });

  test('getKeyId reflects PS_KEY_ID env', () => {
    expect(getKeyId()).toBe(4);
  });
});

describe('PS sid session round-trip', () => {
  test('set→parse→validate returns the userid', () => {
    const { sidCookie } = createPsSession('ROA_Bio', '1.2.3.4');
    const userid = validatePsSid(sidCookie);
    expect(userid).toBe('roabio');
  });

  test('validate rejects a tampered random component', () => {
    const { sidCookie } = createPsSession('Tamper', '1.2.3.4');
    const parts = sidCookie.split(',');
    const tampered = `${parts[0]},${parts[1]},${'f'.repeat(parts[2].length)}`;
    expect(validatePsSid(tampered)).toBeNull();
  });

  test('validate rejects an unknown session id', () => {
    expect(validatePsSid('Ghost,999999,deadbeef')).toBeNull();
  });

  test('validate rejects malformed (too few comma fields)', () => {
    expect(validatePsSid('justusername')).toBeNull();
    expect(validatePsSid('')).toBeNull();
  });

  test('destroy invalidates a previously valid sid', () => {
    const { sidCookie } = createPsSession('Doomed', '1.2.3.4');
    expect(validatePsSid(sidCookie)).toBe('doomed');
    destroyPsSession(sidCookie);
    expect(validatePsSid(sidCookie)).toBeNull();
  });
});

describe('sid cookie comma-encoding (Chrome drop incident)', () => {
  // The sid value is `username,sessionId,sidRandom` — three comma-separated
  // fields. Raw commas are not valid cookie-octets (RFC 6265); Chrome silently
  // drops such cookies. The Set-Cookie builder must %2C-encode commas.
  test('Set-Cookie value contains NO raw commas in the sid token', () => {
    const { sidCookie } = createPsSession('Comma,User', '1.2.3.4'); // username has its own comma too
    const header = psSidCookieString(sidCookie);
    const sidAttr = header.split(';')[0]; // "sid=..."
    expect(sidAttr.startsWith('sid=')).toBe(true);
    const value = sidAttr.slice('sid='.length);
    expect(value.includes(',')).toBe(false);
    expect(value.includes('%2C')).toBe(true);
  });

  test('encoded cookie round-trips through parsePsSid back to a valid session', () => {
    const { sidCookie } = createPsSession('RoundTrip', '1.2.3.4');
    const header = psSidCookieString(sidCookie);
    const sidAttr = header.split(';')[0];
    // Simulate the browser handing the cookie back in a Cookie header.
    const cookieHeader = `other=1; ${sidAttr}; another=2`;
    const parsed = parsePsSid(cookieHeader);
    expect(parsed).toBe(sidCookie); // decodeURIComponent restored the commas
    expect(validatePsSid(parsed!)).toBe('roundtrip');
  });

  test('parsePsSid returns null when no sid present', () => {
    expect(parsePsSid('foo=bar; baz=qux')).toBeNull();
    expect(parsePsSid(undefined)).toBeNull();
  });
});

describe('cookie flags by environment', () => {
  // NODE_ENV is not 'production' under the test runner, so we expect dev flags.
  test('dev cookie: SameSite=Lax, no Domain, no Secure', () => {
    const header = psSidCookieString('a,1,deadbeef');
    expect(header).toContain('SameSite=Lax');
    expect(header).not.toContain('Domain=');
    expect(header).not.toContain('Secure');
    expect(header).toContain('Path=/');
    expect(header).toContain('Max-Age=');
  });

  test('clear cookie has Max-Age=0', () => {
    const header = clearPsSidCookieString();
    expect(header).toContain('sid=');
    expect(header).toContain('Max-Age=0');
  });
});
