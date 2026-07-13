import type { Database } from './database'

export async function getVoiceMapArtifact(database: Database, runId: string) {
  const artifactResult = await database.query<{ artifact: Record<string, unknown>; synthesisVersion: string }>(
    `SELECT artifact, synthesis_version AS "synthesisVersion" FROM voice_maps WHERE analysis_run_id = $1`, [runId],
  )
  if (!artifactResult.rows[0]) return null
  const themes = await database.query<Record<string, unknown>>(
    `SELECT t.id, t.rank, t.name, t.description AS summary, t.theme_type AS type, t.sentiment, t.confidence,
      t.metrics, t.validation, t.engine_version AS "engineVersion"
     FROM themes t WHERE t.analysis_run_id = $1 ORDER BY t.rank, t.id`, [runId],
  )
  const evidence = await database.query<Record<string, unknown>>(
    `SELECT te.theme_id AS "themeId", rs.id, rs.review_id AS "reviewId", rs.quote_text AS quote,
      rs.quote_start AS "quoteStart", rs.quote_end AS "quoteEnd", te.evidence_strength AS strength,
      te.is_representative AS "isRepresentative", r.body_original AS "originalText", r.rating_value AS rating,
      r.provider, r.entity_name AS entity, r.language, r.source_created_at AS "sourceCreatedAt", r.source_url AS "sourceUrl"
     FROM theme_evidence te
     JOIN review_signals rs ON rs.id = te.signal_id
     JOIN reviews r ON r.id = te.review_id
     JOIN themes t ON t.id = te.theme_id
     WHERE t.analysis_run_id = $1 ORDER BY te.theme_id, te.is_representative DESC, rs.id`, [runId],
  )
  return {
    ...artifactResult.rows[0],
    themes: themes.rows.map((theme) => ({ ...theme, evidence: evidence.rows.filter((item) => item.themeId === theme.id) })),
  }
}

export async function getThemeEvidence(database: Database, themeId: string) {
  const result = await database.query<Record<string, unknown>>(
    `SELECT rs.id, rs.review_id AS "reviewId", rs.signal_type AS "signalType", rs.label, rs.normalized_aspect AS "normalizedAspect",
      rs.sentiment, rs.emotion, rs.confidence, rs.quote_text AS quote, rs.quote_start AS "quoteStart", rs.quote_end AS "quoteEnd",
      r.body_original AS "originalText", r.rating_value AS rating, r.entity_name AS entity, r.language,
      r.source_created_at AS "sourceCreatedAt", te.is_representative AS "isRepresentative"
     FROM theme_evidence te JOIN review_signals rs ON rs.id = te.signal_id JOIN reviews r ON r.id = te.review_id
     WHERE te.theme_id = $1 ORDER BY te.is_representative DESC, rs.confidence DESC, rs.id`, [themeId],
  )
  return result.rows
}
