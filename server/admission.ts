import type { Database, DatabaseClient } from './database'

export const DEFAULT_ORGANIZATION_ACTIVE_JOB_LIMIT = 3

export class AdmissionError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 429) {
    super(message)
  }
}

function activeJobLimit(environment: NodeJS.ProcessEnv) {
  const configured = Number(environment.GARAXE_ORGANIZATION_ACTIVE_JOB_LIMIT || DEFAULT_ORGANIZATION_ACTIVE_JOB_LIMIT)
  return Number.isSafeInteger(configured) && configured > 0 ? configured : DEFAULT_ORGANIZATION_ACTIVE_JOB_LIMIT
}

export async function withOrganizationJobAdmission<Result>(
  database: Database,
  organizationId: string,
  work: (transaction: DatabaseClient) => Promise<Result>,
  environment: NodeJS.ProcessEnv = process.env,
) {
  return database.transaction(async (transaction) => {
    await transaction.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`voice-lab-active-jobs:${organizationId}`])
    const active = await transaction.query<{ count: number }>(
      `SELECT (
        (SELECT COUNT(*) FROM import_jobs i JOIN project_organizations po ON po.project_id = i.project_id
         WHERE po.organization_id = $1 AND i.status IN ('queued','processing'))
        +
        (SELECT COUNT(*) FROM analysis_runs a JOIN project_organizations po ON po.project_id = a.project_id
         WHERE po.organization_id = $1 AND a.status IN ('queued','assembling_dataset','preprocessing','interpreting_clusters'))
      )::int AS count`,
      [organizationId],
    )
    if ((active.rows[0]?.count ?? 0) >= activeJobLimit(environment)) {
      throw new AdmissionError('ORGANIZATION_JOB_LIMIT_REACHED', 'This workspace already has the maximum number of active imports or analyses. Try again after one finishes.')
    }
    return work(transaction)
  })
}
