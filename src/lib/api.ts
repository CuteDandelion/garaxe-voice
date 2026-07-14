import type { ColumnMapping } from './csv'

type ApiResponse<T> = { data: T }

async function apiRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: { 'content-type': 'application/json', ...options?.headers },
  })
  const payload = await response.json() as ApiResponse<T> & { error?: { message?: string } }
  if (!response.ok) throw new Error(payload.error?.message || 'Request failed.')
  return payload.data
}

export type AuthStatus = { needsBootstrap: boolean; stagingAccessEnabled?: boolean }
export type AuthContext = {
  sessionId: string
  user: { id: string; email: string; displayName: string }
  memberships: Array<{ organizationId: string; organizationName: string; role: 'owner' | 'admin' | 'analyst' | 'viewer' }>
}

export const getAuthStatus = () => apiRequest<AuthStatus>('/api/auth/status')
export const getCurrentAuth = () => apiRequest<AuthContext>('/api/auth/me')
export const logout = () => apiRequest<{ signedOut: boolean }>('/api/auth/logout', { method: 'POST' })
export const resumeLocalSession = (email: string) => apiRequest<{ expiresAt: string }>('/api/auth/local-session', { method: 'POST', body: JSON.stringify({ email }) })
export const resumeStagingSession = (email: string, accessKey: string) => apiRequest<{ expiresAt: string }>('/api/auth/staging-session', { method: 'POST', body: JSON.stringify({ email, accessKey }) })
export const bootstrapOwner = (input: { email: string; displayName: string; organizationName: string }) =>
  apiRequest<{ userId: string; organizationId: string; expiresAt: string }>('/api/auth/bootstrap', {
    method: 'POST', body: JSON.stringify(input),
  })

export type GoogleConnection = {
  id: string; organizationId: string; projectId: string; accessTokenExpiresAt: string | null;
  grantedScope: string; status: 'authorization_required' | 'connected' | 'refresh_required' | 'revoked' | 'error';
  capabilities: Record<string, boolean>; updatedAt: string;
}
export type GoogleAccessProbe = {
  authentication: 'passed' | 'failed'; accountAccess: 'passed' | 'empty' | 'failed';
  locationAccess: 'passed' | 'empty' | 'failed' | 'not_tested'; reviewAccess: 'passed' | 'empty' | 'failed' | 'not_tested';
  accountCount: number; locationCount: number; sampledReviewCount: number;
  error?: { stage: string; code: string; message: string };
}
export type GoogleEntity = {
  id: string; connectionId: string; externalId: string; accountExternalId: string | null;
  entityType: 'account' | 'location'; name: string; selected: boolean; available: boolean;
  metadata: Record<string, unknown>; updatedAt: string;
}

export const startGoogleConnection = (projectId: string) => apiRequest<{ authorizationUrl: string; status: 'authorization_required' }>('/api/connections/google/start', { method: 'POST', body: JSON.stringify({ projectId }) })
export const getGoogleConnection = (projectId: string) => apiRequest<GoogleConnection | null>(`/api/projects/${projectId}/connections/google`)
export const probeGoogleConnection = (projectId: string) => apiRequest<GoogleAccessProbe>(`/api/projects/${projectId}/connections/google/probe`, { method: 'POST', body: '{}' })
export const disconnectGoogleConnection = (projectId: string) => apiRequest<{ status: 'revoked' }>(`/api/projects/${projectId}/connections/google`, { method: 'DELETE' })
export const listGoogleEntities = (projectId: string) => apiRequest<GoogleEntity[]>(`/api/projects/${projectId}/connections/google/entities`)
export const discoverGoogleEntities = (projectId: string) => apiRequest<GoogleEntity[]>(`/api/projects/${projectId}/connections/google/entities`, { method: 'POST', body: '{}' })
export const selectGoogleLocations = (projectId: string, entityExternalIds: string[]) => apiRequest<GoogleEntity[]>(`/api/projects/${projectId}/connections/google/entities`, { method: 'PUT', body: JSON.stringify({ entityExternalIds }) })
export const syncGoogleReviews = (projectId: string) => apiRequest<{ id: string; status: 'queued'; selectedLocationCount: number }>(`/api/projects/${projectId}/connections/google/sync`, { method: 'POST', body: '{}' })

export type Project = { id: string; name: string; primaryDecision: string }
export type ImportJob = {
  id: string
  projectId: string
  fileName: string
  status: 'queued' | 'processing' | 'completed' | 'failed'
  totalRows: number
  processedRows: number
  usableRows: number
  writtenRows: number
  ratingOnlyRows: number
  duplicateRows: number
  invalidRows: number
  errorMessage: string | null
}

export type ReviewRecord = {
  id: string
  externalReviewId: string | null
  provider: string
  entityName: string | null
  ratingValue: number | null
  ratingScale: number
  title: string | null
  body: string | null
  language: string | null
  reviewerName: string | null
  ownerReply: string | null
  sourceUrl: string | null
  sourceCreatedAt: string | null
  isRatingOnly: boolean
  importedAt: string
  metadata: Record<string, unknown>
  importJobId?: string
  fileName?: string
}

export type ReviewInventoryQuery = {
  cursor?: string | null
  limit?: number
  provider?: string
  entity?: string
  ratingMin?: number | null
  ratingMax?: number | null
  dateFrom?: string
  dateTo?: string
  language?: string
  hasText?: boolean | null
  search?: string
}

export type ReviewSummary = {
  total: number
  writtenCount: number
  ratingOnlyCount: number
  providerCount: number
  entityCount: number
  earliestDate: string | null
  latestDate: string | null
  averageRating: string | number | null
  breakdowns: {
    providers: Array<{ value: string; count: number }>
    entities: Array<{ value: string; count: number }>
    languages: Array<{ value: string; count: number }>
    ratings: Array<{ value: number; count: number }>
  }
}

export type ReviewDetail = {
  review: ReviewRecord
  sourceRecord: { id: string; rowNumber: number; rawPayload: Record<string, unknown>; payloadHash: string; importedAt: string }
  importJob: { id: string; fileName: string; status: string; createdAt: string }
}

export type AnalysisConfiguration = {
  objective: 'full_voice_map' | 'complaints' | 'positive_language' | 'operational_issues' | 'purchase_drivers' | 'location_comparison'
  dateFrom?: string
  dateTo?: string
  entities: string[]
  ratings: number[]
  languages: string[]
  writtenOnly: boolean
  minTextLength: number
}

export type AnalysisQualityReport = {
  preprocessingVersion: string
  found: number
  included: number
  excluded: number
  exclusionReasons: Record<string, number>
  written: number
  ratingOnly: number
  languageDistribution: Record<string, number>
  averageTextLength: number
  medianTextLength: number
  duplicateGroupCount: number
  confidence: 'high' | 'moderate' | 'emerging' | 'weak' | 'insufficient'
  semanticAnalysis?: {
    pipelineVersion: string
    clusteringVersion: string
    segmentCount: number
    clusterCount: number
    clusteredSegmentCount: number
    outlierCount: number
    ambiguousSegmentCount: number
    clusteringParameters: {
      neighbours: number
      similarityThreshold: number
      minimumClusterSize: number
      minimumIndependentReviews: number
      minimumMeanSimilarity: number
      minimumMemberSimilarity: number
      ambiguityMargin: number
    }
  }
  clusterInterpretation?: {
    state: string
    engineVersion?: string
    acceptedThemes?: number
    validatedThemes?: number
    coverage?: number
  }
}

export type AnalysisRun = {
  id: string
  projectId: string
  objective: AnalysisConfiguration['objective']
  configuration: AnalysisConfiguration
  status: 'queued' | 'running' | 'assembling_dataset' | 'preprocessing' | 'interpreting_clusters' | 'completed' | 'failed'
  stage: string
  pipelineVersion: string
  counts: { found?: number; included?: number; excluded?: number } | null
  qualityReport: AnalysisQualityReport | null
  errorMessage: string | null
  createdAt: string
  startedAt: string | null
  completedAt: string | null
  llmProgress: AnalysisLlmProgress | null
}

export type AnalysisLlmProgress = {
  total: number
  queued: number
  waiting: number
  inFlight: number
  succeeded: number
  fallback: number
  failed: number
  completed: number
  remaining: number
  percent: number
  validatedThemes: number
  interpretedThemes: number
  coverage: number
  provider: string | null
  model: string | null
  updatedAt: string | null
}

export type AnalysisMembershipRecord = {
  reviewId: string
  inclusionStatus: 'included' | 'excluded'
  exclusionReason: string | null
  normalizedText: string | null
  preprocessingVersion: string
  originalText: string | null
  ratingValue: number | null
  language: string | null
  entityName: string | null
}

export type VoiceMapArtifactResponse = {
  run: AnalysisRun
  synthesisVersion: string
  artifact: {
    validationThreshold: number
    voiceMap: {
      engineVersion: string
      executiveConclusion: EngineInsight
      primaryPain: EngineInsight | null
      desiredOutcome: EngineInsight | null
      mainObjection: EngineInsight | null
      emotionalDriver: EngineInsight | null
      journeyStages: Array<{ stage: string; label: string; supportingThemeIds: string[]; evidenceReviewCount: number }>
      customerPhrases: Array<{ signalId: string; reviewId: string; quoteText: string; confidence: number }>
      recommendedMoves: Array<{ function: 'Messaging' | 'Operations' | 'Sales' | 'Product'; recommendation: string; supportingThemeIds: string[]; evidenceReviewCount: number }>
    }
  }
  themes: Array<{
    id: string; rank: number; name: string; summary: string; type: string; sentiment: string; confidence: string
    metrics: { signalCount: number; independentReviewCount: number; prevalence: number; averageRating: number | null; contradictionRatio: number; rootCauseRatio?: number; entityBreakdown: Array<{ value: string; count: number }>; languageBreakdown: Array<{ value: string; count: number }> }
    validation: {
      status: string
      repeatedPhrases: Array<{ text: string; count: number }>
      interpretationCandidate?: {
        label: string
        aspect: string
        evaluation: 'praise' | 'pain' | 'mixed'
        signalTypes: Array<'pain' | 'desired_outcome' | 'objection' | 'praise' | 'purchase_trigger' | 'operational_issue' | 'emotion'>
        rootCause: string | null
        consequence: string | null
        confidence: number
        publicationAction: 'publish' | 'discard'
        publicationReason: string | null
        provider: string
        model: string
        promptVersion: string
        schemaVersion: string
        groupingAction?: 'keep' | 'split'
        groupingReason?: string | null
      }
    }
    evidence: Array<{ id: string; reviewId: string; quote: string; quoteStart?: number; quoteEnd?: number; originalText?: string; rating: number | null; provider?: string; entity: string | null; language: string | null; sourceCreatedAt: string | null; sourceUrl?: string | null; strength: number; isRepresentative: boolean }>
  }>
}

type EngineInsight = { title: string; narrative: string; supportingThemeIds: string[]; evidenceReviewCount: number; confidence: string }

export type CurationActionType = 'approve_theme' | 'reject_theme' | 'edit_theme' | 'pin_evidence' | 'exclude_evidence' | 'merge_themes' | 'split_theme' | 'mark_ready'
export type CurationSession = { id: string; analysisRunId: string; status: 'in_progress' | 'ready'; revision: number; createdAt: string; readyAt: string | null }
export type CurationAction = { id: string; sessionId: string; analysisRunId: string; sequence: number; actionType: CurationActionType; payload: Record<string, unknown>; createdAt: string }
export type CuratedEvidence = { signalId: string; reviewId: string; quote: string; quoteStart: number; quoteEnd: number; originalText: string; entity: string | null; provider: string; rating: number | null; sourceCreatedAt: string | null; confidence: number; pinned: boolean; excluded: boolean }
export type EffectiveTheme = {
  id: string; machineThemeId: string | null; originThemeIds: string[]; rank: number; name: string; summary: string
  type: string; sentiment: string; confidence: string; validationStatus: string
  status: 'pending' | 'approved' | 'rejected' | 'consumed' | 'not_reviewable'
  evidence: CuratedEvidence[]; groupingSuggestion: { action: 'split'; reason: string } | null; publishable: boolean
}
export type CurationProjection = {
  session: CurationSession | null
  machineThemes: EffectiveTheme[]
  effectiveThemes: EffectiveTheme[]
  actions: CurationAction[]
  readiness: { validatedMachineThemes: number; resolved: number; pending: number; approved: number; rejected: number; consumed: number; publishable: number; canMarkReady: boolean; isReady: boolean }
}

export type ReportRecord = {
  id: string
  projectId: string
  analysisRunId: string
  curationSessionId: string
  curationRevision: number
  version: number
  title: string
  generatedAt: string
  snapshot?: {
    schemaVersion: string
    generatedAt: string
    analysisRun: AnalysisRun
    curation: { sessionId: string; revision: number; readyAt: string }
    versions: { pipeline: string; synthesis: string; report: string }
    dataset: { counts: Record<string, number>; qualityReport: AnalysisQualityReport; sourceCount?: number }
    narrative: {
      headline: string; executiveSummary: string; signals: Array<Record<string, unknown>>
      opportunities?: string[]; risks?: string[]
      actions?: Array<{ priority: 'now' | 'next' | 'later'; title: string; rationale: string; themeIds: string[]; successMeasure: string }>
      provenance?: { generator: 'llm' | 'curated_interpretations'; schemaVersion: string; provider: string | null; model: string | null; generatedAt: string }
    }
    charts?: {
      ratingDistribution: Array<{ rating: number; count: number }>
      reviewTimeline: Array<{ period: string; count: number }>
      themePrevalence: Array<{ themeId: string; name: string; reviewCount: number }>
    }
    themes: Array<{
      id: string; rank: number; name: string; summary: string; type: string; sentiment: string; confidence: string
      evidence: Array<{ signalId: string; reviewId: string; quote: string; originalText: string | null; sourceCreatedAt: string | null; provider: string; entity: string | null; rating: number | null; pinned: boolean }>
    }>
  }
}

export function createProject(name: string, primaryDecision = 'explore', bootstrap = false) {
  return apiRequest<Project>('/api/projects', {
    method: 'POST',
    body: JSON.stringify({ name, primaryDecision, bootstrap }),
  })
}

export function listProjects() {
  return apiRequest<Project[]>('/api/projects')
}

export function createCurationSession(runId: string) {
  return apiRequest<{ session: CurationSession; created: boolean }>(`/api/analysis-runs/${runId}/curation-sessions`, { method: 'POST' })
}

export function getCurationProjection(runId: string) {
  return apiRequest<CurationProjection>(`/api/analysis-runs/${runId}/curation`)
}

export function createReport(input: { projectId: string; analysisRunId: string; title?: string }) {
  return apiRequest<ReportRecord>('/api/reports', { method: 'POST', body: JSON.stringify(input) })
}

export function listReports(projectId: string) {
  return apiRequest<ReportRecord[]>(`/api/projects/${projectId}/reports`)
}

export function getReport(reportId: string) {
  return apiRequest<ReportRecord>(`/api/reports/${reportId}`)
}

export async function downloadReportPdf(reportId: string, title: string) {
  const response = await fetch(`/api/reports/${reportId}/pdf`)
  if (!response.ok) throw new Error('PDF download failed.')
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${title.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase() || 'voice-map'}.pdf`
  anchor.click()
  URL.revokeObjectURL(url)
}

export function appendCurationAction(sessionId: string, actionType: CurationActionType, payload: Record<string, unknown>) {
  return apiRequest<{ action: CurationAction; projection: CurationProjection }>(`/api/curation-sessions/${sessionId}/actions`, {
    method: 'POST', body: JSON.stringify({ actionType, payload }),
  })
}

export type OriginalImportSource = { encoding: 'utf8' | 'base64'; content: string; mediaType: string }

export function createImport(input: { projectId: string; fileName: string; rawCsv: string; mapping: ColumnMapping; originalSource: OriginalImportSource }) {
  return apiRequest<Pick<ImportJob, 'id' | 'status' | 'totalRows'>>('/api/imports', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function getImport(id: string) {
  return apiRequest<ImportJob>(`/api/imports/${id}`)
}

export async function waitForImport(id: string, intervalMs = 120) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const job = await getImport(id)
    if (job.status === 'completed' || job.status === 'failed') return job
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error('Import did not finish in time.')
}

export function listReviews(projectId: string, query: ReviewInventoryQuery = {}) {
  const parameters = reviewQueryParameters(query, true)
  const suffix = parameters.size ? `?${parameters.toString()}` : ''
  return apiRequest<{ items: ReviewRecord[]; nextCursor: string | null; hasMore: boolean }>(`/api/projects/${projectId}/reviews${suffix}`)
}

export function getReviewSummary(projectId: string) {
  return apiRequest<ReviewSummary>(`/api/projects/${projectId}/review-summary`)
}

export function getFilteredReviewSummary(projectId: string, query: ReviewInventoryQuery = {}) {
  const parameters = reviewQueryParameters(query, false)
  const suffix = parameters.size ? `?${parameters.toString()}` : ''
  return apiRequest<ReviewSummary>(`/api/projects/${projectId}/review-summary${suffix}`)
}

function reviewQueryParameters(query: ReviewInventoryQuery, includePage: boolean) {
  const parameters = new URLSearchParams()
  const keys: Record<keyof ReviewInventoryQuery, string> = {
    cursor: 'cursor', limit: 'limit', provider: 'provider', entity: 'entity',
    ratingMin: 'rating_min', ratingMax: 'rating_max', dateFrom: 'date_from',
    dateTo: 'date_to', language: 'language', hasText: 'has_text', search: 'search',
  }
  for (const [key, value] of Object.entries(query) as Array<[keyof ReviewInventoryQuery, ReviewInventoryQuery[keyof ReviewInventoryQuery]]>) {
    if ((!includePage && (key === 'cursor' || key === 'limit')) || value === undefined || value === null || value === '') continue
    parameters.set(keys[key], String(value))
  }
  return parameters
}

export function getReviewDetail(reviewId: string) {
  return apiRequest<ReviewDetail>(`/api/reviews/${reviewId}`)
}

export function createAnalysisRun(projectId: string, configuration: AnalysisConfiguration) {
  return apiRequest<AnalysisRun>('/api/analysis-runs', { method: 'POST', body: JSON.stringify({ projectId, configuration }) })
}

export function getAnalysisRun(runId: string) {
  return apiRequest<AnalysisRun>(`/api/analysis-runs/${runId}`)
}

export function listAnalysisRuns(projectId: string) {
  return apiRequest<AnalysisRun[]>(`/api/projects/${projectId}/analysis-runs`)
}

export function listAnalysisMembership(runId: string, limit = 500) {
  return apiRequest<AnalysisMembershipRecord[]>(`/api/analysis-runs/${runId}/reviews?limit=${limit}`)
}

export async function waitForAnalysisRun(runId: string, intervalMs = 500, onProgress?: (run: AnalysisRun) => void) {
  for (let attempt = 0; attempt < 2_400; attempt += 1) {
    const run = await getAnalysisRun(runId)
    onProgress?.(run)
    if (run.status === 'completed' || run.status === 'failed') return run
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error('Analysis run did not finish in time.')
}

export function getVoiceMapArtifact(runId: string) {
  return apiRequest<VoiceMapArtifactResponse>(`/api/analysis-runs/${runId}/voice-map`)
}
