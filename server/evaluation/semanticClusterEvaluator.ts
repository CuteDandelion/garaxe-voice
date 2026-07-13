import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  clusterEmbeddingsByMutualKnn,
  createOnnxEmbeddingProvider,
  type SemanticClusteringOptions,
} from '../semanticAnalysis'

export type SemanticGoldCase = { id: string; topic: string; text: string }
export type SemanticEvaluationFixture = {
  version: string
  thresholds: {
    minimumPurity: number
    minimumPairRecall: number
    minimumCoverage: number
    maximumCrossTopicMergeRate: number
    minimumMixedClusterAdjudicationRecall: number
  }
  cases: SemanticGoldCase[]
}

export function scoreSemanticAssignments(cases: SemanticGoldCase[], assignments: number[]) {
  if (cases.length !== assignments.length) throw new Error('Semantic assignments must match fixture cases.')
  const clusters = new Map<number, Map<string, number>>()
  let assigned = 0
  for (const [index, cluster] of assignments.entries()) {
    if (cluster < 0) continue
    assigned += 1
    const topics = clusters.get(cluster) ?? new Map<string, number>()
    topics.set(cases[index].topic, (topics.get(cases[index].topic) ?? 0) + 1)
    clusters.set(cluster, topics)
  }
  const majority = [...clusters.values()].reduce((total, topics) =>
    total + Math.max(0, ...topics.values()), 0)
  let sameTopicPairs = 0
  let recoveredSameTopicPairs = 0
  let crossTopicPairs = 0
  let mergedCrossTopicPairs = 0
  for (let left = 0; left < cases.length; left += 1) {
    for (let right = left + 1; right < cases.length; right += 1) {
      const sameTopic = cases[left].topic === cases[right].topic
      const sameCluster = assignments[left] >= 0 && assignments[left] === assignments[right]
      if (sameTopic) {
        sameTopicPairs += 1
        if (sameCluster) recoveredSameTopicPairs += 1
      } else {
        crossTopicPairs += 1
        if (sameCluster) mergedCrossTopicPairs += 1
      }
    }
  }
  return {
    purity: assigned ? majority / assigned : 0,
    pairRecall: sameTopicPairs ? recoveredSameTopicPairs / sameTopicPairs : 0,
    coverage: cases.length ? assigned / cases.length : 0,
    crossTopicMergeRate: crossTopicPairs ? mergedCrossTopicPairs / crossTopicPairs : 0,
    assigned,
    total: cases.length,
    clusterCount: clusters.size,
  }
}

export function validateSemanticFixture(value: unknown): SemanticEvaluationFixture {
  const fixture = value as SemanticEvaluationFixture
  if (!fixture || typeof fixture.version !== 'string' || !Array.isArray(fixture.cases) || fixture.cases.length < 6) {
    throw new Error('Semantic evaluation fixture is invalid.')
  }
  if (fixture.cases.some((item) => !item.id || !item.topic || !item.text)) throw new Error('Every semantic case needs id, topic, and text.')
  if (new Set(fixture.cases.map((item) => item.id)).size !== fixture.cases.length) throw new Error('Semantic case ids must be unique.')
  const topicCounts = fixture.cases.reduce<Map<string, number>>((counts, item) => counts.set(item.topic, (counts.get(item.topic) ?? 0) + 1), new Map())
  if ([...topicCounts.values()].some((count) => count < 3)) throw new Error('Every semantic topic needs at least three paraphrases.')
  return fixture
}

export async function evaluateSemanticFixture(
  fixturePath = resolve('server/fixtures/semantic-diversity-gold.json'),
  clusteringOptions: Partial<SemanticClusteringOptions> = {},
) {
  const fixture = validateSemanticFixture(JSON.parse(await readFile(fixturePath, 'utf8')))
  const provider = await createOnnxEmbeddingProvider()
  const vectors = await provider.embed(fixture.cases.map((item) => item.text))
  const clustering = clusterEmbeddingsByMutualKnn(vectors, fixture.cases.map((item) => item.id), clusteringOptions)
  const baseMetrics = scoreSemanticAssignments(fixture.cases, clustering.assignments)
  const topicsByCluster = new Map<number, Set<string>>()
  fixture.cases.forEach((item, index) => {
    const cluster = clustering.assignments[index]
    if (cluster < 0) return
    const topics = topicsByCluster.get(cluster) ?? new Set<string>()
    topics.add(item.topic)
    topicsByCluster.set(cluster, topics)
  })
  const mixedClusters = [...topicsByCluster.entries()].filter(([, topics]) => topics.size > 1).map(([cluster]) => cluster)
  const flaggedMixedClusters = mixedClusters.filter((cluster) => clustering.diagnostics.find((item) => item.cluster === cluster)?.needsAdjudication)
  const metrics = {
    ...baseMetrics,
    mixedClusterAdjudicationRecall: mixedClusters.length ? flaggedMixedClusters.length / mixedClusters.length : 1,
  }
  const passed = metrics.purity >= fixture.thresholds.minimumPurity
    && metrics.pairRecall >= fixture.thresholds.minimumPairRecall
    && metrics.coverage >= fixture.thresholds.minimumCoverage
    && metrics.crossTopicMergeRate <= fixture.thresholds.maximumCrossTopicMergeRate
    && metrics.mixedClusterAdjudicationRecall >= fixture.thresholds.minimumMixedClusterAdjudicationRecall
  return { fixture: fixture.version, model: provider.version, metrics, thresholds: fixture.thresholds, diagnostics: clustering.diagnostics, passed }
}

async function main() {
  const result = await evaluateSemanticFixture()
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  if (!result.passed) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) void main()
