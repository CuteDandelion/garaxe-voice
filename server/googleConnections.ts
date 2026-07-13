import { randomUUID } from 'node:crypto'
import type { Database } from './database'
import type { GoogleCredentials } from './googleOAuth'

export async function saveGoogleConnection(database: Database, input: {
  organizationId: string; projectId: string; userId: string; credentials: GoogleCredentials;
}) {
  const id = randomUUID()
  const result = await database.query<{ id: string }>(
    `INSERT INTO google_business_connections
      (id, organization_id, project_id, connected_by_user_id, encrypted_access_token,
       encrypted_refresh_token, access_token_expires_at, granted_scope, status, capabilities)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (organization_id, project_id) DO UPDATE SET
       connected_by_user_id = EXCLUDED.connected_by_user_id,
       encrypted_access_token = EXCLUDED.encrypted_access_token,
       encrypted_refresh_token = EXCLUDED.encrypted_refresh_token,
       access_token_expires_at = EXCLUDED.access_token_expires_at,
       granted_scope = EXCLUDED.granted_scope,
       status = EXCLUDED.status, capabilities = EXCLUDED.capabilities,
       updated_at = NOW(), revoked_at = NULL
     RETURNING id`,
    [id, input.organizationId, input.projectId, input.userId, input.credentials.encryptedAccessToken,
      input.credentials.encryptedRefreshToken, input.credentials.accessTokenExpiresAt?.toISOString() ?? null,
      input.credentials.grantedScope, input.credentials.status, JSON.stringify(input.credentials.capabilities)],
  )
  return result.rows[0].id
}

export async function getGoogleConnection(database: Database, projectId: string) {
  const result = await database.query<{
    id: string; organizationId: string; projectId: string; encryptedAccessToken: string;
    encryptedRefreshToken: string | null; accessTokenExpiresAt: string | null; grantedScope: string;
    status: GoogleCredentials['status']; capabilities: GoogleCredentials['capabilities']; updatedAt: string;
  }>(
    `SELECT id, organization_id AS "organizationId", project_id AS "projectId",
       encrypted_access_token AS "encryptedAccessToken", encrypted_refresh_token AS "encryptedRefreshToken",
       access_token_expires_at AS "accessTokenExpiresAt", granted_scope AS "grantedScope",
       status, capabilities, updated_at AS "updatedAt"
     FROM google_business_connections WHERE project_id = $1`, [projectId],
  )
  return result.rows[0] ?? null
}

export async function revokeGoogleConnection(database: Database, connectionId: string) {
  await database.query(
    `UPDATE google_business_connections SET encrypted_access_token = '', encrypted_refresh_token = NULL,
       access_token_expires_at = NULL, granted_scope = '', status = 'revoked', capabilities = '{}'::jsonb,
       revoked_at = NOW(), updated_at = NOW() WHERE id = $1`, [connectionId],
  )
}

export function publicGoogleConnection(connection: Awaited<ReturnType<typeof getGoogleConnection>>) {
  if (!connection) return null
  const { encryptedAccessToken: _access, encryptedRefreshToken: _refresh, ...safe } = connection
  return safe
}
