import type { ExtractedSignal, SignalExtractionReview, SignalSentiment, SignalType } from './signalExtraction'

export const SEMANTIC_ANALYSIS_VERSION = 'semantic-cluster-pipeline-v4'
export const SEMANTIC_CLUSTERING_VERSION = 'mutual-knn-cluster-v1'
export const SEMANTIC_MODEL_ID = 'Xenova/multilingual-e5-small'
export const SEMANTIC_MODEL_DTYPE = 'q8'
export const SEMANTIC_MODEL_REVISION = '761b726dd34fb83930e26aab4e9ac3899aa1fa78'
export const SENTIMENT_MODEL_ID = 'Xenova/distilbert-base-multilingual-cased-sentiments-student'
export const SENTIMENT_MODEL_DTYPE = 'q8'
export const SENTIMENT_MODEL_REVISION = '9d9ac661fd7b0b48535a1fc99b20ae6947629e65'

export const e5Input = (text: string) => /^(?:query|passage):\s/u.test(text) ? text : `passage: ${text}`

export type ReviewSegment = {
  id: string
  reviewId: string
  text: string
  start: number
  end: number
  rating: number | null
  language: string | null
  entity: string | null
  sourceCreatedAt: string | Date | null
}

export type EmbeddingProvider = {
  id: string
  version: string
  dimensions: number
  embed(texts: string[]): Promise<number[][]>
}

export type SegmentPolarity = { sentiment: SignalSentiment; confidence: number }
export type SentimentProvider = {
  id: string
  version: string
  classify(segments: ReviewSegment[]): Promise<SegmentPolarity[]>
}

export type SemanticAnalysisResult = {
  signals: ExtractedSignal[]
  metadata: {
    pipelineVersion: typeof SEMANTIC_ANALYSIS_VERSION
    embeddingModel: string
    embeddingVersion: string
    embeddingDimensions: number
    sentimentModel: string
    sentimentVersion: string
    segmentCount: number
    clusterCount: number
    clusteredSegmentCount: number
    outlierCount: number
    ambiguousSegmentCount: number
    clusteringVersion: typeof SEMANTIC_CLUSTERING_VERSION
    clusteringParameters: SemanticClusteringOptions
    clusterDiagnostics: SemanticClusterDiagnostic[]
  }
}

export type SemanticClusteringOptions = {
  neighbours: number
  similarityThreshold: number
  minimumClusterSize: number
  minimumIndependentReviews: number
  minimumMeanSimilarity: number
  minimumMemberSimilarity: number
  ambiguityMargin: number
}

export type SemanticClusterDiagnostic = {
  cluster: number
  size: number
  independentReviewCount: number
  meanSimilarity: number
  minimumMemberSimilarity: number
  ambiguousMemberCount: number
  needsAdjudication: boolean
}

export type SemanticClusteringResult = {
  assignments: number[]
  clusterCount: number
  outlierCount: number
  ambiguousSegmentCount: number
  parameters: SemanticClusteringOptions
  diagnostics: SemanticClusterDiagnostic[]
}

export const DEFAULT_SEMANTIC_CLUSTERING_OPTIONS: SemanticClusteringOptions = {
  neighbours: 6,
  similarityThreshold: 0.84,
  minimumClusterSize: 2,
  minimumIndependentReviews: 2,
  minimumMeanSimilarity: 0.84,
  minimumMemberSimilarity: 0.81,
  ambiguityMargin: 0.03,
}

export const DETERMINISTIC_TEST_CLUSTERING_OPTIONS: Partial<SemanticClusteringOptions> = {
  similarityThreshold: 0.3,
  minimumMeanSimilarity: 0.25,
  minimumMemberSimilarity: 0.1,
  ambiguityMargin: 0.05,
}

const clauseBoundary = /(?<=[.!?;:\n])\s+|\s+(?=(?:but|however|although|yet|while)\b)/giu
const termsPattern = /[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N}'’-]*/gu
const representationStopWords = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'for', 'from', 'had', 'has', 'have', 'i', 'in', 'is', 'it',
  'of', 'on', 'or', 'our', 'so', 'that', 'the', 'their', 'they', 'this', 'to', 'was', 'we', 'were', 'with', 'would', 'you', 'your',
  'across', 'after', 'because', 'before', 'came', 'come', 'during', 'happened', 'ordered', 'then', 'visit', 'visited', 'when', 'which',
  'aber', 'am', 'auf', 'das', 'dem', 'den', 'der', 'des', 'die', 'ein', 'eine', 'einem', 'einen', 'einer', 'im', 'ist', 'mit', 'und', 'war', 'waren', 'wir', 'zum', 'zur',
  'de', 'del', 'el', 'era', 'fue', 'fuimos', 'la', 'las', 'los', 'muy', 'para', 'pero', 'por', 'que', 'un', 'una', 'unos', 'unas',
  'avons', 'des', 'du', 'et', 'était', 'le', 'les', 'mais', 'nous', 'une',
  'abbiamo', 'con', 'di', 'e', 'era', 'gli', 'i', 'il', 'le', 'lo', 'ma',
])
const negationTerms = new Set(['aint', 'cannot', 'cant', 'didnt', 'doesnt', 'dont', 'kein', 'keine', 'keinen', 'nicht', 'no', 'nobody', 'none', 'not', 'nothing', 'never', 'ni', 'nadie', 'pas', 'sans', 'senza', 'without'])
const weakLeadingNegationTerms = new Set(['kein', 'keine', 'keinen', 'nicht', 'no', 'not', 'never', 'ni', 'pas', 'sans', 'senza', 'without'])

function normalizeTerm(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase('und').replace(/[’']/g, '')
}

function splitWithOffsets(text: string) {
  const parts: Array<{ text: string; start: number; end: number }> = []
  let cursor = 0
  for (const match of text.matchAll(clauseBoundary)) {
    const boundary = match.index ?? cursor
    const raw = text.slice(cursor, boundary)
    const leading = raw.search(/\S/u)
    if (leading >= 0) {
      const trailing = raw.match(/\s*$/u)?.[0].length ?? 0
      const start = cursor + leading
      const end = boundary - trailing
      if (end > start) parts.push({ text: text.slice(start, end), start, end })
    }
    cursor = boundary + match[0].length
  }
  const raw = text.slice(cursor)
  const leading = raw.search(/\S/u)
  if (leading >= 0) {
    const trailing = raw.match(/\s*$/u)?.[0].length ?? 0
    const start = cursor + leading
    const end = text.length - trailing
    if (end > start) parts.push({ text: text.slice(start, end), start, end })
  }
  return parts
}

export function segmentReviews(reviews: SignalExtractionReview[]): ReviewSegment[] {
  return reviews.flatMap((review) => splitWithOffsets(review.text ?? '').map((part, index) => ({
    id: `${review.reviewId}:segment:${index + 1}`,
    reviewId: review.reviewId,
    text: part.text,
    start: part.start,
    end: part.end,
    rating: review.rating ?? null,
    language: review.language ?? null,
    entity: review.entity ?? null,
    sourceCreatedAt: review.sourceCreatedAt ?? null,
  })))
}

function dot(left: number[], right: number[]) {
  let total = 0
  for (let index = 0; index < left.length; index += 1) total += left[index] * (right[index] ?? 0)
  return total
}

function normalize(vector: number[]) {
  const magnitude = Math.sqrt(dot(vector, vector)) || 1
  return vector.map((value) => value / magnitude)
}

function mean(vectors: number[][], dimensions: number) {
  const result = Array.from({ length: dimensions }, () => 0)
  for (const vector of vectors) for (let index = 0; index < dimensions; index += 1) result[index] += vector[index] ?? 0
  return normalize(result.map((value) => value / Math.max(vectors.length, 1)))
}

function boundedUnit(value: number, name: string) {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${name} must be between zero and one`)
  return value
}

function validatedClusteringOptions(options: Partial<SemanticClusteringOptions> = {}): SemanticClusteringOptions {
  const values = { ...DEFAULT_SEMANTIC_CLUSTERING_OPTIONS, ...options }
  if (!Number.isInteger(values.neighbours) || values.neighbours < 1) throw new Error('neighbours must be a positive integer')
  if (!Number.isInteger(values.minimumClusterSize) || values.minimumClusterSize < 2) throw new Error('minimumClusterSize must be at least two')
  if (!Number.isInteger(values.minimumIndependentReviews) || values.minimumIndependentReviews < 2) throw new Error('minimumIndependentReviews must be at least two')
  boundedUnit(values.similarityThreshold, 'similarityThreshold')
  boundedUnit(values.minimumMeanSimilarity, 'minimumMeanSimilarity')
  boundedUnit(values.minimumMemberSimilarity, 'minimumMemberSimilarity')
  boundedUnit(values.ambiguityMargin, 'ambiguityMargin')
  return values
}

function roundedSimilarity(value: number) {
  return Math.round(value * 10_000) / 10_000
}

export function clusterEmbeddingsByMutualKnn(
  vectors: number[][],
  reviewIds: string[],
  options: Partial<SemanticClusteringOptions> = {},
): SemanticClusteringResult {
  const parameters = validatedClusteringOptions(options)
  if (vectors.length !== reviewIds.length) throw new Error('Semantic clustering requires one review ID per vector.')
  if (!vectors.length) return { assignments: [], clusterCount: 0, outlierCount: 0, ambiguousSegmentCount: 0, parameters, diagnostics: [] }
  const normalized = vectors.map(normalize)
  const similarities = normalized.map((left, leftIndex) => normalized.map((right, rightIndex) => leftIndex === rightIndex ? 1 : dot(left, right)))
  const neighbourCount = Math.min(parameters.neighbours, Math.max(0, vectors.length - 1))
  const neighbours = similarities.map((row, sourceIndex) => new Set(row
    .map((similarity, targetIndex) => ({ similarity, targetIndex }))
    .filter(({ targetIndex, similarity }) => targetIndex !== sourceIndex && similarity >= parameters.similarityThreshold)
    .sort((left, right) => right.similarity - left.similarity || left.targetIndex - right.targetIndex)
    .slice(0, neighbourCount)
    .map(({ targetIndex }) => targetIndex)))
  const parent = vectors.map((_, index) => index)
  const find = (index: number): number => parent[index] === index ? index : (parent[index] = find(parent[index]))
  const unite = (left: number, right: number) => {
    const leftRoot = find(left)
    const rightRoot = find(right)
    if (leftRoot !== rightRoot) parent[Math.max(leftRoot, rightRoot)] = Math.min(leftRoot, rightRoot)
  }
  neighbours.forEach((targets, source) => targets.forEach((target) => {
    if (neighbours[target].has(source)) unite(source, target)
  }))
  const components = new Map<number, number[]>()
  vectors.forEach((_, index) => {
    const root = find(index)
    const members = components.get(root) ?? []
    members.push(index)
    components.set(root, members)
  })
  const assignments = Array.from({ length: vectors.length }, () => -1)
  const accepted: Array<{ members: number[]; meanSimilarity: number; memberMeans: number[] }> = []
  const coherentGroups = [...components.values()].sort((left, right) => left[0] - right[0]).flatMap((members) => {
    const groups: number[][] = []
    for (const member of members) {
      const candidates = groups.map((group, index) => ({
        index,
        average: group.reduce((total, peer) => total + similarities[member][peer], 0) / group.length,
        minimum: Math.min(...group.map((peer) => similarities[member][peer])),
      })).filter((candidate) => candidate.average >= parameters.minimumMeanSimilarity
        && candidate.minimum >= parameters.minimumMemberSimilarity)
        .sort((left, right) => right.average - left.average || left.index - right.index)
      if (candidates[0]) groups[candidates[0].index].push(member)
      else groups.push([member])
    }
    return groups
  })
  for (const members of coherentGroups) {
    const memberMeans = members.map((member) => {
      const peers = members.filter((candidate) => candidate !== member)
      return peers.length ? peers.reduce((total, peer) => total + similarities[member][peer], 0) / peers.length : 0
    })
    const pairSimilarities = members.flatMap((member, memberIndex) => members.slice(memberIndex + 1).map((peer) => similarities[member][peer]))
    const meanSimilarity = pairSimilarities.length ? pairSimilarities.reduce((total, value) => total + value, 0) / pairSimilarities.length : 0
    const independentReviews = new Set(members.map((member) => reviewIds[member])).size
    if (members.length < parameters.minimumClusterSize
      || independentReviews < parameters.minimumIndependentReviews
      || meanSimilarity < parameters.minimumMeanSimilarity
      || Math.min(...memberMeans) < parameters.minimumMemberSimilarity) continue
    const cluster = accepted.length
    members.forEach((member) => { assignments[member] = cluster })
    accepted.push({ members, meanSimilarity, memberMeans })
  }
  const centroids = accepted.map(({ members }) => mean(members.map((member) => normalized[member]), normalized[0].length))
  let ambiguousSegmentCount = 0
  const diagnostics = accepted.map(({ members, meanSimilarity, memberMeans }, cluster) => {
    let ambiguousMemberCount = 0
    for (const member of members) {
      const ownSimilarity = dot(normalized[member], centroids[cluster])
      const alternativeSimilarity = Math.max(-1, ...centroids.filter((_, index) => index !== cluster).map((centroid) => dot(normalized[member], centroid)))
      if (alternativeSimilarity >= 0 && ownSimilarity - alternativeSimilarity < parameters.ambiguityMargin) ambiguousMemberCount += 1
    }
    ambiguousSegmentCount += ambiguousMemberCount
    return {
      cluster,
      size: members.length,
      independentReviewCount: new Set(members.map((member) => reviewIds[member])).size,
      meanSimilarity: roundedSimilarity(meanSimilarity),
      minimumMemberSimilarity: roundedSimilarity(Math.min(...memberMeans)),
      ambiguousMemberCount,
      needsAdjudication: ambiguousMemberCount > 0
        || meanSimilarity < Math.min(1, parameters.similarityThreshold + 0.05)
        || Math.min(...memberMeans) < Math.min(1, parameters.minimumMemberSimilarity + 0.03),
    }
  })
  return {
    assignments,
    clusterCount: accepted.length,
    outlierCount: assignments.filter((assignment) => assignment < 0).length,
    ambiguousSegmentCount,
    parameters,
    diagnostics,
  }
}

function phrases(text: string) {
  const words = [...text.matchAll(termsPattern)]
    .map((match) => normalizeTerm(match[0]))
    .filter((word) => word.length > 2 && !representationStopWords.has(word))
  return [
    ...words,
    ...words.slice(0, -1).map((word, index) => `${word} ${words[index + 1]}`),
    ...words.slice(0, -2).map((word, index) => `${word} ${words[index + 1]} ${words[index + 2]}`),
  ]
}

function clusterRepresentations(segments: ReviewSegment[], assignments: number[]) {
  const clusterCount = Math.max(...assignments, -1) + 1
  const documents = Array.from({ length: clusterCount }, () => new Map<string, Set<string>>())
  const clusterReviews = Array.from({ length: clusterCount }, () => new Set<string>())
  segments.forEach((segment, index) => {
    const cluster = assignments[index]
    if (cluster < 0) return
    clusterReviews[cluster].add(segment.reviewId)
    for (const phrase of phrases(segment.text)) {
      const reviews = documents[cluster].get(phrase) ?? new Set<string>()
      reviews.add(segment.reviewId)
      documents[cluster].set(phrase, reviews)
    }
  })
  const documentFrequency = new Map<string, number>()
  for (const document of documents) for (const term of document.keys()) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1)
  const rankedByCluster = documents.map((document, cluster) => {
    const scored = [...document.entries()].map(([term, reviews]) => ({
      term,
      score: (reviews.size / Math.max(clusterReviews[cluster].size, 1))
        * Math.log(1 + clusterCount / (documentFrequency.get(term) ?? 1))
        * (1 + (term.split(' ').length - 1) * .35),
      frequency: reviews.size,
      causeWeight: term.split(' ').some((word) => negationTerms.has(word)) ? 1 : 0,
      causePosition: term.split(' ').findIndex((word) => negationTerms.has(word)),
      weakLead: weakLeadingNegationTerms.has(term.split(' ')[0]) ? 1 : 0,
    }))
    const supportedPhrases = scored.filter((candidate) => candidate.frequency >= 2 && candidate.term.includes(' '))
    const supportedWords = scored.filter((candidate) => candidate.frequency >= 2 && !candidate.term.includes(' '))
    const candidates = supportedPhrases.length ? supportedPhrases : supportedWords
    return candidates.sort((left, right) => right.frequency - left.frequency
      || right.causeWeight - left.causeWeight
      || left.weakLead - right.weakLead
      || (left.causePosition < 0 ? Number.POSITIVE_INFINITY : left.causePosition) - (right.causePosition < 0 ? Number.POSITIVE_INFINITY : right.causePosition)
      || right.score - left.score
      || right.term.split(' ').length - left.term.split(' ').length
      || left.term.localeCompare(right.term))
  })
  return rankedByCluster.map((clusterCandidates, cluster) => {
    const supportedPhrase = clusterCandidates.find((candidate) => candidate.frequency >= 2 && candidate.term.includes(' '))
    if (supportedPhrase) return supportedPhrase.term
    const memberPhrases = segments.flatMap((segment, index) => assignments[index] === cluster
      ? phrases(segment.text).filter((phrase) => phrase.includes(' ')).map((phrase) => ({ phrase, index }))
      : [])
    return memberPhrases.sort((left, right) => left.phrase.localeCompare(right.phrase) || left.index - right.index)[0]?.phrase
      || clusterCandidates.filter((candidate) => candidate.frequency >= 2).slice(0, 2).map((candidate) => candidate.term).join(' ')
      || `semantic cluster ${cluster + 1}`
  })
}

function signalClassification(polarity: SegmentPolarity): { type: SignalType; sentiment: SignalSentiment } {
  if (polarity.sentiment === 'negative') return { type: 'pain_point', sentiment: 'negative' }
  if (polarity.sentiment === 'positive') return { type: 'praise', sentiment: 'positive' }
  return { type: 'product_aspect', sentiment: 'neutral' }
}

let defaultProviderPromise: Promise<EmbeddingProvider> | null = null
let defaultSentimentProviderPromise: Promise<SentimentProvider> | null = null

export function createOnnxEmbeddingProvider(): Promise<EmbeddingProvider> {
  if (defaultProviderPromise) return defaultProviderPromise
  defaultProviderPromise = import('@huggingface/transformers').then(async ({ pipeline }) => {
    const extractor = await pipeline('feature-extraction', SEMANTIC_MODEL_ID, { dtype: SEMANTIC_MODEL_DTYPE, revision: SEMANTIC_MODEL_REVISION })
    return {
      id: SEMANTIC_MODEL_ID,
      version: `${SEMANTIC_MODEL_ID}@${SEMANTIC_MODEL_REVISION}:${SEMANTIC_MODEL_DTYPE}`,
      dimensions: 384,
      async embed(texts: string[]) {
        const vectors: number[][] = []
        for (let offset = 0; offset < texts.length; offset += 32) {
          const output = await extractor(texts.slice(offset, offset + 32).map(e5Input), { pooling: 'mean', normalize: true })
          vectors.push(...output.tolist() as number[][])
        }
        return vectors
      },
    }
  })
  return defaultProviderPromise
}

function normalizedSentimentLabel(value: string): SignalSentiment {
  const label = value.toLocaleLowerCase('und')
  if (label.includes('negative')) return 'negative'
  if (label.includes('positive')) return 'positive'
  return 'neutral'
}

export function createOnnxSentimentProvider(): Promise<SentimentProvider> {
  if (defaultSentimentProviderPromise) return defaultSentimentProviderPromise
  defaultSentimentProviderPromise = import('@huggingface/transformers').then(async ({ pipeline }) => {
    const classifier = await pipeline('sentiment-analysis', SENTIMENT_MODEL_ID, { dtype: SENTIMENT_MODEL_DTYPE, revision: SENTIMENT_MODEL_REVISION })
    return {
      id: SENTIMENT_MODEL_ID,
      version: `${SENTIMENT_MODEL_ID}@${SENTIMENT_MODEL_REVISION}:${SENTIMENT_MODEL_DTYPE}`,
      async classify(segments: ReviewSegment[]) {
        const results: SegmentPolarity[] = []
        for (let offset = 0; offset < segments.length; offset += 32) {
          const output = await classifier(segments.slice(offset, offset + 32).map((segment) => segment.text), { top_k: 1 }) as unknown
          const batch = Array.isArray(output) ? output : [output]
          for (const value of batch) {
            const candidate = Array.isArray(value) ? value[0] : value
            const record = candidate as { label?: string; score?: number }
            results.push({ sentiment: normalizedSentimentLabel(record.label || 'neutral'), confidence: Number(record.score || 0) })
          }
        }
        return results
      },
    }
  })
  return defaultSentimentProviderPromise
}

export function createDeterministicTestEmbeddingProvider(dimensions = 48): EmbeddingProvider {
  return {
    id: 'test-character-ngram-embedding',
    version: 'test-character-ngram-embedding-v1',
    dimensions,
    async embed(texts: string[]) {
      return texts.map((text) => {
        const vector = Array.from({ length: dimensions }, () => 0)
        const normalizedText = `  ${text.normalize('NFKC').toLocaleLowerCase('und')}  `
        for (let index = 0; index <= normalizedText.length - 3; index += 1) {
          const gram = normalizedText.slice(index, index + 3)
          let hash = 2166136261
          for (const character of gram) { hash ^= character.charCodeAt(0); hash = Math.imul(hash, 16777619) }
          vector[(hash >>> 0) % dimensions] += 1
        }
        return normalize(vector)
      })
    },
  }
}

export function createDeterministicTestSentimentProvider(): SentimentProvider {
  return {
    id: 'test-segment-sentiment', version: 'test-segment-sentiment-v1',
    async classify(segments) {
      return segments.map((segment) => {
        const text = segment.text.toLocaleLowerCase('und')
        if (/excellent|bright|balanced|memorable|friendly|great|fresh/u.test(text)) return { sentiment: 'positive', confidence: .9 }
        if (/cold|leak|nobody|not clean|slow|rude|uncomfortable|missing/u.test(text)) return { sentiment: 'negative', confidence: .9 }
        if (segment.rating !== null && segment.rating <= 2) return { sentiment: 'negative', confidence: .62 }
        if (segment.rating !== null && segment.rating >= 4) return { sentiment: 'positive', confidence: .62 }
        return { sentiment: 'neutral', confidence: .7 }
      })
    },
  }
}

function clusterByPolarity(
  vectors: number[][],
  polarities: SegmentPolarity[],
  segments: ReviewSegment[],
  options: Partial<SemanticClusteringOptions> = {},
) {
  const assignments = Array.from({ length: vectors.length }, () => -1)
  let offset = 0
  let outlierCount = 0
  let ambiguousSegmentCount = 0
  const diagnostics: SemanticClusterDiagnostic[] = []
  let parameters = validatedClusteringOptions()
  for (const sentiment of ['negative', 'neutral', 'positive'] as const) {
    const indices = polarities.flatMap((polarity, index) => polarity.sentiment === sentiment ? [index] : [])
    if (!indices.length) continue
    const cohort = clusterEmbeddingsByMutualKnn(
      indices.map((index) => vectors[index]),
      indices.map((index) => segments[index].reviewId),
      options,
    )
    parameters = cohort.parameters
    indices.forEach((sourceIndex, index) => {
      assignments[sourceIndex] = cohort.assignments[index] < 0 ? -1 : offset + cohort.assignments[index]
    })
    diagnostics.push(...cohort.diagnostics.map((diagnostic) => ({ ...diagnostic, cluster: diagnostic.cluster + offset })))
    offset += cohort.clusterCount
    outlierCount += cohort.outlierCount
    ambiguousSegmentCount += cohort.ambiguousSegmentCount
  }
  return { assignments, clusterCount: offset, outlierCount, ambiguousSegmentCount, parameters, diagnostics }
}

export async function analyzeSemantically(
  reviews: SignalExtractionReview[],
  provider?: EmbeddingProvider,
  sentimentProvider?: SentimentProvider,
  clusteringOptions: Partial<SemanticClusteringOptions> = {},
): Promise<SemanticAnalysisResult> {
  const segments = segmentReviews(reviews)
  const [embeddingProvider, polarityProvider] = await Promise.all([
    provider ?? createOnnxEmbeddingProvider(),
    sentimentProvider ?? (provider ? createDeterministicTestSentimentProvider() : createOnnxSentimentProvider()),
  ])
  if (!segments.length) return {
    signals: [],
    metadata: { pipelineVersion: SEMANTIC_ANALYSIS_VERSION, embeddingModel: embeddingProvider.id, embeddingVersion: embeddingProvider.version, embeddingDimensions: embeddingProvider.dimensions, sentimentModel: polarityProvider.id, sentimentVersion: polarityProvider.version, segmentCount: 0, clusterCount: 0, clusteredSegmentCount: 0, outlierCount: 0, ambiguousSegmentCount: 0, clusteringVersion: SEMANTIC_CLUSTERING_VERSION, clusteringParameters: validatedClusteringOptions(), clusterDiagnostics: [] },
  }
  const [vectors, polarities] = await Promise.all([
    embeddingProvider.embed(segments.map((segment) => segment.text)),
    polarityProvider.classify(segments),
  ])
  if (vectors.length !== segments.length || vectors.some((vector) => vector.length !== embeddingProvider.dimensions)) throw new Error('Semantic embedding output does not match the segmented dataset.')
  if (polarities.length !== segments.length) throw new Error('Sentiment output does not match the segmented dataset.')
  const clustering = clusterByPolarity(vectors, polarities, segments, clusteringOptions)
  const { assignments, clusterCount } = clustering
  const representations = clusterRepresentations(segments, assignments)
  const clusterCounts = assignments.reduce<Map<number, number>>((counts, cluster) => counts.set(cluster, (counts.get(cluster) ?? 0) + 1), new Map())
  const ordinals = new Map<string, number>()
  const signals = segments.map((segment, index) => {
    const ordinal = (ordinals.get(segment.reviewId) ?? 0) + 1
    ordinals.set(segment.reviewId, ordinal)
    const polarity = polarities[index]
    const classification = signalClassification(polarity)
    const cluster = assignments[index]
    const normalizedAspect = cluster < 0 ? `unclustered ${segment.id}` : representations[cluster]
    const causeBearing = normalizedAspect.split(' ').some((word) => negationTerms.has(word))
    return {
      id: `${segment.reviewId}:semantic:${ordinal}`,
      ordinal,
      reviewId: segment.reviewId,
      signalType: classification.type,
      label: cluster < 0 ? 'Unclustered feedback' : `Customers discuss ${normalizedAspect}`,
      normalizedAspect,
      sentiment: classification.sentiment,
      confidence: cluster < 0 ? 0.35 : Math.min(0.92, 0.58 + ((clusterCounts.get(cluster) ?? 1) / Math.max(segments.length, 1))),
      quoteText: segment.text,
      quoteStart: segment.start,
      quoteEnd: segment.end,
      attributes: {
        extractorVersion: SEMANTIC_ANALYSIS_VERSION,
        extractionMode: 'semantic_cluster',
        segmentId: segment.id,
        cluster,
        clusterStatus: cluster < 0 ? 'unclustered' : 'clustered',
        clusteringVersion: SEMANTIC_CLUSTERING_VERSION,
        ...(cluster < 0 ? {} : { clusterDiagnostic: clustering.diagnostics.find((diagnostic) => diagnostic.cluster === cluster) }),
        embeddingModel: embeddingProvider.id,
        embeddingVersion: embeddingProvider.version,
        embeddingDimensions: embeddingProvider.dimensions,
        sentimentModel: polarityProvider.id,
        sentimentVersion: polarityProvider.version,
        sentimentConfidence: polarity.confidence,
        causeBearing,
        ...(segment.rating === null ? {} : { rating: segment.rating }),
        ...(segment.language ? { language: segment.language } : {}),
        ...(segment.entity ? { entity: segment.entity } : {}),
        ...(segment.sourceCreatedAt ? { sourceCreatedAt: segment.sourceCreatedAt instanceof Date ? segment.sourceCreatedAt.toISOString() : segment.sourceCreatedAt } : {}),
      },
    } satisfies ExtractedSignal
  })
  return {
    signals,
    metadata: {
      pipelineVersion: SEMANTIC_ANALYSIS_VERSION,
      embeddingModel: embeddingProvider.id,
      embeddingVersion: embeddingProvider.version,
      embeddingDimensions: embeddingProvider.dimensions,
      sentimentModel: polarityProvider.id,
      sentimentVersion: polarityProvider.version,
      segmentCount: segments.length,
      clusterCount,
      clusteredSegmentCount: segments.length - clustering.outlierCount,
      outlierCount: clustering.outlierCount,
      ambiguousSegmentCount: clustering.ambiguousSegmentCount,
      clusteringVersion: SEMANTIC_CLUSTERING_VERSION,
      clusteringParameters: clustering.parameters,
      clusterDiagnostics: clustering.diagnostics,
    },
  }
}
