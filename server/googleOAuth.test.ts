import { describe, expect, it, vi } from 'vitest';
import {
  decryptSecret, encryptSecret, GoogleOAuthClient, GoogleOAuthError,
  InMemoryOAuthStateStore, GOOGLE_AUTHORIZATION_ENDPOINT, GOOGLE_REVOKE_ENDPOINT,
  GOOGLE_TOKEN_ENDPOINT,
} from './googleOAuth.js';

const key = Buffer.alloc(32, 7);
const now = new Date('2026-07-12T12:00:00Z');
const input = { organizationId: 'org-a', userId: 'user-a', redirectUri: 'https://app.test/oauth/google/callback' };

function client(fetch = vi.fn<typeof globalThis.fetch>(), store = new InMemoryOAuthStateStore(), at = now) {
  return { client: new GoogleOAuthClient({ clientId: 'client-id', clientSecret: 'client-secret',
    envelopeKey: key, stateStore: store, fetch, now: () => at }), fetch, store };
}

function callbackParts(authorizationUrl: string) {
  const url = new URL(authorizationUrl);
  return { url, state: url.searchParams.get('state')! };
}

describe('Google OAuth confidentiality and authorization lifecycle', () => {
  it('creates Google authorization with opaque state, offline access, and S256 PKCE', async () => {
    const { client: oauth } = client();
    const { authorizationUrl } = await oauth.beginAuthorization(input);
    const { url, state } = callbackParts(authorizationUrl);
    expect(url.origin + url.pathname).toBe(GOOGLE_AUTHORIZATION_ENDPOINT);
    expect(url.searchParams.get('scope')).toContain('business.manage');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('include_granted_scopes')).toBe('true');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(state).not.toContain('org-a');
  });

  it('encrypts and authenticates secret envelopes', () => {
    const encrypted = encryptSecret('refresh-secret', key);
    expect(encrypted).not.toContain('refresh-secret');
    expect(decryptSecret(encrypted, key)).toBe('refresh-secret');
    const decoded = JSON.parse(Buffer.from(encrypted, 'base64url').toString());
    const ciphertext = Buffer.from(decoded.ciphertext, 'base64url');
    ciphertext[0] ^= 1;
    decoded.ciphertext = ciphertext.toString('base64url');
    expect(() => decryptSecret(Buffer.from(JSON.stringify(decoded)).toString('base64url'), key))
      .toThrowError(expect.objectContaining({ code: 'OAUTH_SECRET_INVALID' }));
  });

  it.each([
    ['wrong organization', { organizationId: 'org-b', userId: 'user-a' }],
    ['wrong user', { organizationId: 'org-a', userId: 'user-b' }],
  ])('rejects %s binding', async (_label, binding) => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    const { client: oauth } = client(fetch);
    const state = callbackParts((await oauth.beginAuthorization(input)).authorizationUrl).state;
    await expect(oauth.exchangeAuthorizationCode({ state, code: 'code', ...binding }))
      .rejects.toMatchObject({ code: 'OAUTH_STATE_INVALID' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects expired state and single-use replay', async () => {
    const store = new InMemoryOAuthStateStore();
    const successfulFetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(JSON.stringify({
      access_token: 'access', refresh_token: 'refresh', expires_in: 3600,
    }), { status: 200 }));
    const original = client(successfulFetch, store, now).client;
    const first = callbackParts((await original.beginAuthorization(input)).authorizationUrl).state;
    await original.exchangeAuthorizationCode({ state: first, code: 'code', organizationId: 'org-a', userId: 'user-a' });
    await expect(original.exchangeAuthorizationCode({ state: first, code: 'code', organizationId: 'org-a', userId: 'user-a' }))
      .rejects.toMatchObject({ code: 'OAUTH_STATE_INVALID' });

    const expiring = client(successfulFetch, store, now).client;
    const expiredState = callbackParts((await expiring.beginAuthorization(input)).authorizationUrl).state;
    const later = client(successfulFetch, store, new Date(now.getTime() + 11 * 60_000)).client;
    await expect(later.exchangeAuthorizationCode({ state: expiredState, code: 'code', organizationId: 'org-a', userId: 'user-a' }))
      .rejects.toMatchObject({ code: 'OAUTH_STATE_INVALID' });
  });

  it('exchanges the code with its confidential verifier and encrypts returned tokens', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(JSON.stringify({
      access_token: 'access-secret', refresh_token: 'refresh-secret', expires_in: 3600,
      scope: 'https://www.googleapis.com/auth/business.manage',
    }), { status: 200 }));
    const { client: oauth } = client(fetch);
    const state = callbackParts((await oauth.beginAuthorization(input)).authorizationUrl).state;
    const credentials = await oauth.exchangeAuthorizationCode({ state, code: 'authorization-code', organizationId: 'org-a', userId: 'user-a' });
    expect(fetch).toHaveBeenCalledWith(GOOGLE_TOKEN_ENDPOINT, expect.anything());
    const request = fetch.mock.calls[0]![1]!;
    const body = request.body as URLSearchParams;
    expect(body.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(credentials.encryptedAccessToken).not.toContain('access-secret');
    expect(decryptSecret(credentials.encryptedRefreshToken!, key)).toBe('refresh-secret');
    expect(credentials.status).toBe('connected');
    expect(credentials.capabilities.canWriteReplies).toBe(false);
  });

  it('preserves the old refresh token when Google does not rotate it and accepts rotation', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'new-a', expires_in: 20 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'new-b', refresh_token: 'rotated', expires_in: 20 }), { status: 200 }));
    const { client: oauth } = client(fetch);
    const original = { encryptedAccessToken: encryptSecret('old-a', key), encryptedRefreshToken: encryptSecret('old-r', key),
      accessTokenExpiresAt: now, grantedScope: 'scope', status: 'refresh_required' as const,
      capabilities: { canListAccounts: true, canListLocations: true, canReadReviews: true, canReadReplies: true, canWriteReplies: false as const } };
    const preserved = await oauth.refresh(original);
    expect(preserved.encryptedRefreshToken).toBe(original.encryptedRefreshToken);
    const rotated = await oauth.refresh(preserved);
    expect(decryptSecret(rotated.encryptedRefreshToken!, key)).toBe('rotated');
  });

  it('returns safe errors without exposing Google response bodies or tokens', async () => {
    const secretBody = 'provider says secret-token-is-invalid';
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(secretBody, { status: 400 }));
    const { client: oauth } = client(fetch);
    const state = callbackParts((await oauth.beginAuthorization(input)).authorizationUrl).state;
    let error: unknown;
    try { await oauth.exchangeAuthorizationCode({ state, code: 'secret-code', organizationId: 'org-a', userId: 'user-a' }); }
    catch (caught) { error = caught; }
    expect(error).toBeInstanceOf(GoogleOAuthError);
    expect(String(error)).not.toContain(secretBody);
    expect(String(error)).not.toContain('secret-code');
  });

  it('revokes remotely and clears local credential material', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response('', { status: 200 }));
    const { client: oauth } = client(fetch);
    const result = await oauth.disconnect({ encryptedAccessToken: encryptSecret('access', key),
      encryptedRefreshToken: encryptSecret('refresh', key), accessTokenExpiresAt: now,
      grantedScope: 'scope', status: 'connected', capabilities: { canListAccounts: true,
        canListLocations: true, canReadReviews: true, canReadReplies: true, canWriteReplies: false } });
    expect(fetch).toHaveBeenCalledWith(GOOGLE_REVOKE_ENDPOINT, expect.anything());
    expect((fetch.mock.calls[0]![1]!.body as URLSearchParams).get('token')).toBe('refresh');
    expect(result).toMatchObject({ status: 'revoked', encryptedAccessToken: '', encryptedRefreshToken: null });
  });
});
