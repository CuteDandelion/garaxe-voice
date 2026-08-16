// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import {
  aspectSemanticsEnabled,
  canonicalAspectIdentity,
  canonicalAspectFingerprint,
  canonicalAspectKey,
  compatibleAspectDecisionPlan,
  compatibleReviewDecisionPlan,
  compatiblePairDecisionPlan,
  canonicalEmbeddingContentHash,
  semanticContractKey,
  reuseCompatibleReviewDecisions,
  reuseCompatibleAspectDecisions,
  type PersistedPairDecision,
  type PersistedReviewDecision,
} from './incrementalAnalysis'

const contract = {
  pipelineVersion: 'semantic-voice-map-v5',
  preprocessingVersion: 'deterministic-preprocessing-v1',
  embeddingModel: 'Xenova/multilingual-e5-small',
  embeddingVersion: 'model@revision:q8',
  promptVersion: 'semantic-taxonomy-v2-v22',
  schemaVersion: 'cluster-interpretation-v9',
  model: 'qwen3.7-plus',
  candidateVersion: 'category-first-source-plan-v2',
  routingPolicy: 'capacity-governed-routing-v6',
}

describe('incremental semantic lineage', () => {
  it('enables aspect semantics only through the explicit runtime flag', () => {
    expect(aspectSemanticsEnabled({ VOICE_LAB_ASPECT_SEMANTICS_ENABLED: 'true' })).toBe(true)
    expect(aspectSemanticsEnabled({ VOICE_LAB_ASPECT_SEMANTICS_ENABLED: 'false' })).toBe(false)
    expect(aspectSemanticsEnabled({})).toBe(false)
  })

  it('derives a stable exact aspect identity without collapsing distinct aspects', () => {
    expect(canonicalAspectIdentity('Pain Point', '  Café   checkout ')).toBe(
      canonicalAspectIdentity('pain point', 'Cafe\u0301 checkout'),
    )
    expect(canonicalAspectIdentity('pain point', 'checkout delay')).not.toBe(
      canonicalAspectIdentity('pain point', 'checkout failure'),
    )
  })

  it('keeps reuse identity stable when only a corpus-derived aspect label changes', () => {
    const immutable = {
      contentHash: 'review-hash', signalType: 'pain', quoteText: 'Checkout took too long.', quoteStart: 4, quoteEnd: 27,
    }
    const first = { ...immutable, normalizedAspect: 'checkout delay' }
    const second = { ...immutable, normalizedAspect: 'slow payment flow' }
    expect(canonicalAspectKey(first)).toBe(canonicalAspectKey(second))
    expect(canonicalAspectFingerprint(first)).toBe(canonicalAspectFingerprint(second))
  })

  it('reuses exact-compatible aspect decisions and fails closed on incomplete prior lineage', () => {
    const contractKey = semanticContractKey(contract)
    const stored = [{
      aspectKey: 'aspect-a', signalFingerprint: 'fingerprint-a', contractKey,
      outcome: { label: 'Saved aspect' },
    }]
    expect(compatibleAspectDecisionPlan([
      { signalId: 'new-a', aspectKey: 'aspect-a', signalFingerprint: 'fingerprint-a' },
      { signalId: 'new-b', aspectKey: 'aspect-b', signalFingerprint: 'fingerprint-b' },
    ], stored, contract, new Set(['aspect-a']))).toEqual({
      reusable: [{ ...stored[0], signalId: 'new-a' }], unseenSignalIds: ['new-b'], compatible: true,
    })
    expect(compatibleAspectDecisionPlan([
      { signalId: 'new-a', aspectKey: 'aspect-a', signalFingerprint: 'changed' },
      { signalId: 'new-b', aspectKey: 'aspect-b', signalFingerprint: 'fingerprint-b' },
    ], stored, contract, new Set(['aspect-a']))).toEqual({
      reusable: [], unseenSignalIds: ['new-a', 'new-b'], compatible: false,
    })
  })

  it('keys canonical embeddings by normalized content independent of batch partition', () => {
    const first = ['  Café onboarding  ', 'Export report'].map(canonicalEmbeddingContentHash)
    const partitioned = [['  Café onboarding  '], ['Export report']].flatMap((batch) => batch.map(canonicalEmbeddingContentHash))
    expect(partitioned).toEqual(first)
    expect(canonicalEmbeddingContentHash('Cafe\u0301 onboarding')).toBe(canonicalEmbeddingContentHash('Café onboarding'))
  })
  it('reuses every compatible review decision and sends only appended reviews for interpretation', () => {
    const stored: PersistedReviewDecision[] = ['review-a', 'review-b'].map((reviewId) => ({
      reviewId,
      contentHash: `hash-${reviewId}`,
      contractKey: semanticContractKey(contract),
      outcome: { label: reviewId },
    }))

    expect(compatibleReviewDecisionPlan([
      { reviewId: 'review-a', contentHash: 'hash-review-a' },
      { reviewId: 'review-b', contentHash: 'hash-review-b' },
      { reviewId: 'review-c', contentHash: 'hash-review-c' },
    ], stored, contract)).toEqual({
      reusable: stored,
      unseenReviewIds: ['review-c'],
      compatible: true,
    })
  })

  it('fails closed to a full run when any existing review has incomplete or incompatible lineage', () => {
    const stored: PersistedReviewDecision[] = [{
      reviewId: 'review-a', contentHash: 'stale-hash', contractKey: semanticContractKey(contract), outcome: {},
    }]
    expect(compatibleReviewDecisionPlan([
      { reviewId: 'review-a', contentHash: 'hash-review-a' },
      { reviewId: 'review-b', contentHash: 'hash-review-b' },
    ], stored, contract, new Set(['review-a']))).toEqual({ reusable: [], unseenReviewIds: ['review-a', 'review-b'], compatible: false })
  })

  it('fails closed when a prior-run review is missing from the fresh immutable inventory', () => {
    const stored: PersistedReviewDecision[] = [{
      reviewId: 'review-a', contentHash: 'hash-review-a', contractKey: semanticContractKey(contract), outcome: {},
    }]
    expect(compatibleReviewDecisionPlan([
      { reviewId: 'review-a', contentHash: 'hash-review-a' },
    ], stored, contract, new Set(['review-a', 'review-b']))).toEqual({
      reusable: [], unseenReviewIds: ['review-a'], compatible: false,
    })
  })

  it('reuses both accepted and rejected canonical pair decisions and adjudicates unseen pairs once', () => {
    const stored: PersistedPairDecision[] = [
      { pairId: 'review-a::review-b', contractKey: semanticContractKey(contract), sameTopic: true },
      { pairId: 'review-a::review-c', contractKey: semanticContractKey(contract), sameTopic: false },
    ]
    expect(compatiblePairDecisionPlan([
      'review-a::review-b', 'review-a::review-c', 'review-b::review-c',
    ], stored, contract)).toEqual({
      reusable: stored,
      unseenPairIds: ['review-b::review-c'],
    })
  })

  it('copies exact-compatible saved review outcomes into a fresh immutable run and leaves appended reviews unseen', async () => {
    const database = new PGlite()
    await database.exec(`
      CREATE TABLE analysis_runs (id UUID PRIMARY KEY, project_id UUID, configuration JSONB, pipeline_version TEXT, status TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), completed_at TIMESTAMPTZ);
      CREATE TABLE reviews (id UUID PRIMARY KEY, project_id UUID, canonical_hash TEXT);
      CREATE TABLE analysis_run_reviews (analysis_run_id UUID, review_id UUID, inclusion_status TEXT, preprocessing_version TEXT);
      CREATE TABLE review_signals (id TEXT PRIMARY KEY, analysis_run_id UUID, review_id UUID, confidence DOUBLE PRECISION, quote_text TEXT, quote_start INTEGER, attributes JSONB);
      CREATE TABLE project_review_semantic_decisions (project_id UUID, review_id UUID, content_hash TEXT, contract_key TEXT, outcome JSONB);
      CREATE TABLE project_semantic_embeddings (project_id UUID, content_hash TEXT, embedding TEXT);
      CREATE TABLE project_review_pair_decisions (project_id UUID, left_review_id UUID, right_review_id UUID, contract_key TEXT, same_topic BOOLEAN);
      CREATE TABLE analysis_run_pair_decisions (analysis_run_id UUID, project_id UUID, left_review_id UUID, right_review_id UUID, contract_key TEXT, same_topic BOOLEAN);
    `)
    const project = '00000000-0000-4000-8000-000000000001'
    const oldRun = '00000000-0000-4000-8000-000000000002'
    const newRun = '00000000-0000-4000-8000-000000000003'
    const oldReview = '00000000-0000-4000-8000-000000000004'
    const appended = '00000000-0000-4000-8000-000000000005'
    await database.query(`INSERT INTO analysis_runs VALUES ($1,$3,'{}',$4,'completed',NOW()),($2,$3,'{}',$4,'interpreting_clusters',NOW())`, [oldRun, newRun, project, contract.pipelineVersion])
    await database.query(`INSERT INTO reviews VALUES ($1,$3,'hash-old'),($2,$3,'hash-new')`, [oldReview, appended, project])
    await database.query(`INSERT INTO analysis_run_reviews VALUES ($1,$3,'included',$5),($2,$3,'included',$5),($2,$4,'included',$5)`, [oldRun, newRun, oldReview, appended, contract.preprocessingVersion])
    await database.query(`INSERT INTO review_signals VALUES ('new:old',$1,$2,.8,'old',0,'{}'),('new:appended',$1,$3,.8,'new',0,'{}')`, [newRun, oldReview, appended])
    await database.query(`INSERT INTO project_review_semantic_decisions VALUES ($1,$2,'hash-old',$3,$4)`, [project, oldReview, semanticContractKey(contract), JSON.stringify({ label: 'Saved outcome' })])

    expect(await reuseCompatibleReviewDecisions(database, newRun, contract)).toEqual({ compatible: true, reused: 1, unseenReviewIds: [appended] })
    const signals = await database.query<{ reviewId: string; outcome: unknown }>(`SELECT review_id AS "reviewId", attributes->'canonicalOutcome' AS outcome FROM review_signals ORDER BY review_id`)
    expect(signals.rows).toEqual([{ reviewId: oldReview, outcome: { label: 'Saved outcome' } }, { reviewId: appended, outcome: null }])
  })

  it('links exact-compatible aspect outcomes into a fresh run and leaves only appended aspects unseen', async () => {
    const database = new PGlite()
    await database.exec(`
      CREATE TABLE analysis_runs (id UUID PRIMARY KEY, project_id UUID, configuration JSONB, pipeline_version TEXT, status TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), completed_at TIMESTAMPTZ);
      CREATE TABLE reviews (id UUID PRIMARY KEY, project_id UUID, canonical_hash TEXT);
      CREATE TABLE analysis_run_reviews (analysis_run_id UUID, review_id UUID, inclusion_status TEXT, preprocessing_version TEXT);
      CREATE TABLE review_signals (id TEXT PRIMARY KEY, analysis_run_id UUID, review_id UUID, signal_type TEXT, normalized_aspect TEXT, confidence DOUBLE PRECISION, quote_text TEXT, quote_start INTEGER, quote_end INTEGER, attributes JSONB);
      CREATE TABLE project_aspect_semantic_decisions (project_id UUID, review_id UUID, aspect_key TEXT, topic_identity TEXT, signal_fingerprint TEXT, contract_key TEXT, outcome JSONB, PRIMARY KEY(project_id,review_id,aspect_key,contract_key));
      CREATE TABLE analysis_run_aspect_decisions (analysis_run_id UUID, project_id UUID, signal_id TEXT, review_id UUID, aspect_key TEXT, contract_key TEXT, PRIMARY KEY(analysis_run_id,signal_id));
    `)
    const project = '00000000-0000-4000-8000-000000000011'
    const oldRun = '00000000-0000-4000-8000-000000000012'
    const newRun = '00000000-0000-4000-8000-000000000013'
    const oldReview = '00000000-0000-4000-8000-000000000014'
    const appended = '00000000-0000-4000-8000-000000000015'
    await database.query(`INSERT INTO analysis_runs VALUES ($1,$3,'{}',$4,'completed',NOW(),NOW()),($2,$3,'{}',$4,'interpreting_clusters',NOW(),NULL)`, [oldRun, newRun, project, contract.pipelineVersion])
    await database.query(`INSERT INTO reviews VALUES ($1,$3,'hash-old'),($2,$3,'hash-new')`, [oldReview, appended, project])
    await database.query(`INSERT INTO analysis_run_reviews VALUES ($1,$3,'included',$5),($2,$3,'included',$5),($2,$4,'included',$5)`, [oldRun, newRun, oldReview, appended, contract.preprocessingVersion])
    const oldInput = { contentHash: 'hash-old', signalType: 'pain', normalizedAspect: 'checkout delay', quoteText: 'checkout delay', quoteStart: 0, quoteEnd: 14 }
    await database.query(`INSERT INTO review_signals VALUES ('old:aspect',$1,$3,'pain','checkout delay',.8,'checkout delay',0,14,'{}'),('new:aspect',$2,$3,'pain','slow payment flow',.8,'checkout delay',0,14,'{}'),('new:append',$2,$4,'desired_outcome','faster checkout',.8,'faster checkout',0,15,'{}')`, [oldRun, newRun, oldReview, appended])
    await database.query(`INSERT INTO project_aspect_semantic_decisions VALUES ($1,$2,$3,$4,$5,$6,$7)`, [
      project, oldReview, canonicalAspectKey(oldInput), canonicalAspectIdentity('pain', 'checkout delay'),
      canonicalAspectFingerprint(oldInput),
      semanticContractKey(contract), JSON.stringify({ label: 'Saved checkout delay' }),
    ])

    expect(await reuseCompatibleAspectDecisions(database, newRun, contract)).toEqual({
      compatible: true, reused: 1, unseenSignalIds: ['new:append'],
    })
    const signals = await database.query<{ id: string; outcome: unknown }>(`SELECT id, attributes->'canonicalOutcome' AS outcome FROM review_signals WHERE analysis_run_id=$1 ORDER BY id`, [newRun])
    expect(signals.rows).toEqual([
      { id: 'new:append', outcome: null }, { id: 'new:aspect', outcome: { label: 'Saved checkout delay' } },
    ])
    expect((await database.query(`SELECT signal_id FROM analysis_run_aspect_decisions WHERE analysis_run_id=$1`, [newRun])).rows)
      .toEqual([{ signal_id: 'new:aspect' }])
  })
})
