import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import type { Database } from './database';

export const GOOGLE_AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
export const GOOGLE_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
export const GOOGLE_BUSINESS_SCOPE = 'https://www.googleapis.com/auth/business.manage';

export type GoogleConnectionStatus =
  | 'authorization_required'
  | 'connected'
  | 'refresh_required'
  | 'revoked'
  | 'error';

export type GoogleCapabilities = {
  canListAccounts: boolean;
  canListLocations: boolean;
  canReadReviews: boolean;
  canReadReplies: boolean;
  canWriteReplies: false;
};

export const GOOGLE_READ_CAPABILITIES: GoogleCapabilities = {
  canListAccounts: true,
  canListLocations: true,
  canReadReviews: true,
  canReadReplies: true,
  canWriteReplies: false,
};

export class GoogleOAuthError extends Error {
  constructor(public readonly code: string, message = 'Google authorization could not be completed.') {
    super(message);
    this.name = 'GoogleOAuthError';
  }
}

type Envelope = { v: 1; iv: string; ciphertext: string; tag: string };

function b64url(value: Buffer): string {
  return value.toString('base64url');
}

/** Encrypts server-confidential OAuth material using an authenticated envelope. */
export function encryptSecret(plaintext: string, key: Buffer): string {
  if (key.length !== 32) throw new Error('OAuth envelope key must be exactly 32 bytes.');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const envelope: Envelope = {
    v: 1,
    iv: b64url(iv),
    ciphertext: b64url(ciphertext),
    tag: b64url(cipher.getAuthTag()),
  };
  return b64url(Buffer.from(JSON.stringify(envelope), 'utf8'));
}

export function decryptSecret(encoded: string, key: Buffer): string {
  if (key.length !== 32) throw new Error('OAuth envelope key must be exactly 32 bytes.');
  try {
    const envelope = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Envelope;
    if (envelope.v !== 1) throw new Error('version');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new GoogleOAuthError('OAUTH_SECRET_INVALID', 'Stored authorization material is unavailable.');
  }
}

export function oauthEnvelopeKeyFromEnv(value = process.env.GARAXE_OAUTH_ENVELOPE_KEY): Buffer {
  if (!value) throw new Error('GARAXE_OAUTH_ENVELOPE_KEY is required.');
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32) throw new Error('GARAXE_OAUTH_ENVELOPE_KEY must be a base64-encoded 32-byte key.');
  return key;
}

export type OAuthStateRecord = {
  stateHash: string;
  organizationId: string;
  userId: string;
  encryptedCodeVerifier: string;
  redirectUri: string;
  expiresAt: Date;
  consumedAt: Date | null;
};

export interface OAuthStateStore {
  create(record: OAuthStateRecord): Promise<void>;
  consume(input: {
    stateHash: string;
    organizationId: string;
    userId: string;
    now: Date;
  }): Promise<OAuthStateRecord | null>;
}

/** Test/local adapter. Production storage must implement atomic consume semantics. */
export class InMemoryOAuthStateStore implements OAuthStateStore {
  private readonly records = new Map<string, OAuthStateRecord>();
  async create(record: OAuthStateRecord): Promise<void> {
    this.records.set(record.stateHash, { ...record });
  }
  async consume(input: { stateHash: string; organizationId: string; userId: string; now: Date }) {
    const record = this.records.get(input.stateHash);
    if (
      !record || record.consumedAt || record.expiresAt.getTime() <= input.now.getTime()
      || !constantTimeEqual(record.organizationId, input.organizationId)
      || !constantTimeEqual(record.userId, input.userId)
    ) return null;
    record.consumedAt = input.now;
    return { ...record };
  }
}

export class DatabaseOAuthStateStore implements OAuthStateStore {
  constructor(private readonly database: Database) {}

  async create(record: OAuthStateRecord) {
    await this.database.query(
      `INSERT INTO google_oauth_states
        (state_hash, organization_id, user_id, encrypted_code_verifier, redirect_uri, expires_at, consumed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [record.stateHash, record.organizationId, record.userId, record.encryptedCodeVerifier, record.redirectUri, record.expiresAt.toISOString(), record.consumedAt],
    );
  }

  async consume(input: { stateHash: string; organizationId: string; userId: string; now: Date }) {
    const result = await this.database.query<{
      stateHash: string; organizationId: string; userId: string; encryptedCodeVerifier: string;
      redirectUri: string; expiresAt: string | Date; consumedAt: string | Date | null;
    }>(
      `UPDATE google_oauth_states SET consumed_at = $4
       WHERE state_hash = $1 AND organization_id = $2 AND user_id = $3
         AND consumed_at IS NULL AND expires_at > $4
       RETURNING state_hash AS "stateHash", organization_id AS "organizationId", user_id AS "userId",
         encrypted_code_verifier AS "encryptedCodeVerifier", redirect_uri AS "redirectUri",
         expires_at AS "expiresAt", consumed_at AS "consumedAt"`,
      [input.stateHash, input.organizationId, input.userId, input.now.toISOString()],
    );
    const row = result.rows[0];
    return row ? { ...row, expiresAt: new Date(row.expiresAt), consumedAt: row.consumedAt ? new Date(row.consumedAt) : null } : null;
  }
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export type GoogleCredentials = {
  encryptedAccessToken: string;
  encryptedRefreshToken: string | null;
  accessTokenExpiresAt: Date | null;
  grantedScope: string;
  status: GoogleConnectionStatus;
  capabilities: GoogleCapabilities;
};

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
};

export class GoogleOAuthClient {
  constructor(private readonly options: {
    clientId: string;
    clientSecret: string;
    envelopeKey: Buffer;
    stateStore: OAuthStateStore;
    fetch?: typeof fetch;
    now?: () => Date;
    stateTtlMs?: number;
  }) {}

  async beginAuthorization(input: { organizationId: string; userId: string; redirectUri: string; projectId?: string }) {
    const state = b64url(Buffer.from(JSON.stringify({ organizationId: input.organizationId, projectId: input.projectId, nonce: b64url(randomBytes(32)) }), 'utf8'));
    const verifier = b64url(randomBytes(32));
    const challenge = b64url(createHash('sha256').update(verifier).digest());
    const now = this.now();
    await this.options.stateStore.create({
      stateHash: sha256(state),
      organizationId: input.organizationId,
      userId: input.userId,
      encryptedCodeVerifier: encryptSecret(verifier, this.options.envelopeKey),
      redirectUri: input.redirectUri,
      expiresAt: new Date(now.getTime() + (this.options.stateTtlMs ?? 10 * 60_000)),
      consumedAt: null,
    });
    const url = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
    url.search = new URLSearchParams({
      client_id: this.options.clientId,
      redirect_uri: input.redirectUri,
      response_type: 'code',
      scope: GOOGLE_BUSINESS_SCOPE,
      access_type: 'offline',
      include_granted_scopes: 'true',
      prompt: 'consent',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }).toString();
    return { authorizationUrl: url.toString(), status: 'authorization_required' as const };
  }

  async exchangeAuthorizationCode(input: {
    state: string; code: string; organizationId?: string; userId: string;
  }): Promise<GoogleCredentials> {
    const organizationId = input.organizationId ?? organizationIdFromOAuthState(input.state);
    const record = await this.options.stateStore.consume({
      stateHash: sha256(input.state), organizationId,
      userId: input.userId, now: this.now(),
    });
    if (!record) throw new GoogleOAuthError('OAUTH_STATE_INVALID', 'Authorization expired or is no longer valid.');
    const verifier = decryptSecret(record.encryptedCodeVerifier, this.options.envelopeKey);
    const token = await this.tokenRequest({
      grant_type: 'authorization_code', code: input.code, redirect_uri: record.redirectUri,
      client_id: this.options.clientId, client_secret: this.options.clientSecret,
      code_verifier: verifier,
    });
    if (!token.refresh_token) throw new GoogleOAuthError('OAUTH_REFRESH_TOKEN_MISSING');
    return this.credentials(token, null);
  }

  async refresh(credentials: GoogleCredentials): Promise<GoogleCredentials> {
    if (!credentials.encryptedRefreshToken) throw new GoogleOAuthError('OAUTH_REAUTHORIZATION_REQUIRED');
    const refreshToken = decryptSecret(credentials.encryptedRefreshToken, this.options.envelopeKey);
    const token = await this.tokenRequest({
      grant_type: 'refresh_token', refresh_token: refreshToken,
      client_id: this.options.clientId, client_secret: this.options.clientSecret,
    });
    return this.credentials(token, credentials.encryptedRefreshToken);
  }

  async disconnect(credentials: GoogleCredentials): Promise<GoogleCredentials> {
    const encrypted = credentials.encryptedRefreshToken ?? credentials.encryptedAccessToken;
    const token = decryptSecret(encrypted, this.options.envelopeKey);
    try {
      const response = await this.fetch()(GOOGLE_REVOKE_ENDPOINT, {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token }),
      });
      if (!response.ok) throw new GoogleOAuthError('OAUTH_REVOCATION_FAILED');
    } catch (error) {
      if (error instanceof GoogleOAuthError) throw error;
      throw new GoogleOAuthError('OAUTH_REVOCATION_FAILED');
    }
    return {
      encryptedAccessToken: '', encryptedRefreshToken: null, accessTokenExpiresAt: null,
      grantedScope: '', status: 'revoked', capabilities: disabledCapabilities(),
    };
  }

  private credentials(token: TokenResponse, preservedRefreshToken: string | null): GoogleCredentials {
    if (!token.access_token) throw new GoogleOAuthError('OAUTH_TOKEN_RESPONSE_INVALID');
    return {
      encryptedAccessToken: encryptSecret(token.access_token, this.options.envelopeKey),
      encryptedRefreshToken: token.refresh_token
        ? encryptSecret(token.refresh_token, this.options.envelopeKey) : preservedRefreshToken,
      accessTokenExpiresAt: typeof token.expires_in === 'number'
        ? new Date(this.now().getTime() + token.expires_in * 1000) : null,
      grantedScope: token.scope ?? GOOGLE_BUSINESS_SCOPE,
      status: 'connected', capabilities: { ...GOOGLE_READ_CAPABILITIES },
    };
  }

  private async tokenRequest(fields: Record<string, string>): Promise<TokenResponse> {
    try {
      const response = await this.fetch()(GOOGLE_TOKEN_ENDPOINT, {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields),
      });
      if (!response.ok) throw new GoogleOAuthError('OAUTH_TOKEN_EXCHANGE_FAILED');
      const value = await response.json() as TokenResponse;
      if (!value || typeof value !== 'object') throw new GoogleOAuthError('OAUTH_TOKEN_RESPONSE_INVALID');
      return value;
    } catch (error) {
      if (error instanceof GoogleOAuthError) throw error;
      throw new GoogleOAuthError('OAUTH_PROVIDER_UNAVAILABLE');
    }
  }

  private fetch(): typeof fetch { return this.options.fetch ?? globalThis.fetch; }
  private now(): Date { return this.options.now?.() ?? new Date(); }
}

export function organizationIdFromOAuthState(state: string) {
  return contextFromOAuthState(state).organizationId;
}

export function contextFromOAuthState(state: string) {
  try {
    const value = JSON.parse(Buffer.from(state, 'base64url').toString('utf8')) as { organizationId?: unknown; projectId?: unknown; nonce?: unknown };
    if (typeof value.organizationId !== 'string' || typeof value.nonce !== 'string' || !value.organizationId || !value.nonce) throw new Error('invalid');
    if (value.projectId !== undefined && typeof value.projectId !== 'string') throw new Error('invalid');
    return { organizationId: value.organizationId, projectId: value.projectId as string | undefined };
  } catch {
    throw new GoogleOAuthError('OAUTH_STATE_INVALID', 'Authorization expired or is no longer valid.');
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function disabledCapabilities(): GoogleCapabilities {
  return { canListAccounts: false, canListLocations: false, canReadReviews: false,
    canReadReplies: false, canWriteReplies: false };
}

/** Managed-Postgres schema; state rows contain no bearer state or plaintext PKCE verifier. */
export const googleOAuthSchemaSql = `
CREATE TABLE IF NOT EXISTS google_oauth_states (
  state_hash TEXT PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  encrypted_code_verifier TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (organization_id, user_id)
    REFERENCES organization_memberships(organization_id, user_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS google_oauth_states_expiry_idx ON google_oauth_states(expires_at);

CREATE TABLE IF NOT EXISTS google_business_connections (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  connected_by_user_id UUID NOT NULL REFERENCES auth_users(id),
  encrypted_access_token TEXT NOT NULL,
  encrypted_refresh_token TEXT,
  access_token_expires_at TIMESTAMPTZ,
  granted_scope TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('authorization_required','connected','refresh_required','revoked','error')),
  capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  UNIQUE (organization_id, project_id),
  FOREIGN KEY (organization_id, connected_by_user_id)
    REFERENCES organization_memberships(organization_id, user_id)
);
CREATE INDEX IF NOT EXISTS google_connections_org_status_idx
  ON google_business_connections(organization_id, status);
`;
