export const SIGNAL_EXTRACTOR_VERSION = 'evidence-signal-extractor-v2'

export type SignalType =
  | 'pain_point'
  | 'desired_outcome'
  | 'objection'
  | 'praise'
  | 'feature_request'
  | 'service_issue'
  | 'purchase_trigger'
  | 'emotion'
  | 'competitor_mention'
  | 'product_aspect'

export type SignalSentiment = 'positive' | 'negative' | 'mixed' | 'neutral'

export type SignalExtractionReview = {
  reviewId: string
  text?: string | null
  rating?: number | null
  language?: string | null
  entity?: string | null
  sourceCreatedAt?: string | Date | null
}

export type ExtractedSignal = {
  id: string
  ordinal: number
  reviewId: string
  signalType: SignalType
  label: string
  normalizedAspect: string
  sentiment: SignalSentiment
  emotion?: string
  confidence: number
  quoteText: string
  quoteStart: number
  quoteEnd: number
  attributes: Record<string, unknown>
}

type Rule = {
  pattern: RegExp
  signalType: SignalType
  label: string
  normalizedAspect: string
  sentiment: SignalSentiment
  emotion?: string
  confidence: number
  skipWhenNegated?: boolean
}

type SignalCandidate = Omit<ExtractedSignal, 'id' | 'ordinal' | 'reviewId'>

const negativeRules: Rule[] = [
  rule(/\b(?:too much setup|setup (?:was|is|feels?) (?:too )?(?:hard|difficult|complicated|confusing)|setup took (?:days|weeks|ages|too long)|hard to (?:set up|configure)|complicated to (?:set up|configure)|configuration (?:was|is) (?:hard|difficult|confusing))\b/gi, 'pain_point', 'Setup feels too complicated', 'setup complexity', 'negative', 'frustration', 0.94),
  rule(/\b(?:not easy to use|wasn['’]t easy to use|isn['’]t easy to use|difficult to use|hard to use|confusing to use|poor usability)\b/gi, 'pain_point', 'The product is difficult to use', 'usability', 'negative', 'frustration', 0.93),
  rule(/\b(?:waited? (?:for )?(?:almost |over |more than )?(?:\d+\s*(?:minutes?|hours?)|an? hour|forever|too long)|long wait(?:ing time)?|waiting time (?:was|is) (?:too )?long|service (?:was|is) (?:very )?slow|took ages)\b/gi, 'service_issue', 'Customers wait too long for service', 'waiting time', 'negative', 'frustration', 0.95),
  rule(/\b(?:staff (?:were|was|are|is) (?:rude|unfriendly|dismissive|unhelpful)|felt unwelcome|poor customer service)\b/gi, 'service_issue', 'Staff interactions feel unwelcoming', 'staff friendliness', 'negative', 'disappointment', 0.94),
  rule(/\b(?:support (?:was|is|were) (?:too )?slow|slow support|support (?:never|didn['’]t) (?:reply|respond)|no response from support|waited? \d+\s*(?:hours?|days?) for (?:a )?(?:reply|response))\b/gi, 'service_issue', 'Support responds too slowly', 'support speed', 'negative', 'frustration', 0.95),
  rule(/\b(?:too expensive|overpriced|not worth (?:it|the (?:money|price))|poor value|price (?:was|is|felt|feels) (?:too )?high|costs? too much)\b/gi, 'objection', 'The price feels high before value is clear', 'price and value', 'negative', 'doubt', 0.93),
  rule(/\b(?:keeps? (?:crashing|breaking)|(?:was|is|were) unreliable|not reliable|stopped working|doesn['’]t work|didn['’]t work|frequent (?:errors|outages)|lost (?:my|our) data)\b/gi, 'pain_point', 'Reliability undermines confidence', 'reliability', 'negative', 'frustration', 0.96),
  rule(/\b(?:documentation (?:was|is) (?:poor|missing|unclear|outdated)|documentation sent (?:me|us) in circles|poor documentation|missing documentation|instructions (?:were|are) unclear|no documentation)\b/gi, 'pain_point', 'Documentation does not answer customer questions', 'documentation', 'negative', 'confusion', 0.94),
  rule(/\b(?:dirty|filthy|not clean|wasn['’]t clean|poor cleanliness|unclean)\b/gi, 'service_issue', 'Cleanliness falls below expectations', 'cleanliness', 'negative', 'disappointment', 0.93),
  rule(/\b(?:delivery (?:was|is) (?:late|slow|delayed)|late delivery|never arrived|package (?:was|is) (?:late|damaged)|order (?:was|is) delayed)\b/gi, 'service_issue', 'Delivery does not meet expectations', 'delivery', 'negative', 'frustration', 0.95),
  rule(/\b(?:wasn['’]t sure (?:it|this) would work for (?:my|our) (?:niche|business|team|use case)|not sure (?:it|this) (?:will|would) work for (?:my|our) (?:niche|business|team|use case)|doubted (?:it|this) would fit (?:my|our) (?:needs|business))\b/gi, 'objection', 'Customers doubt the fit for their situation', 'niche fit', 'negative', 'doubt', 0.96),
]

const positiveRules: Rule[] = [
  rule(/\b(?:easy to use|simple to use)\b/gi, 'praise', 'The product feels easy to use', 'usability', 'positive', 'relief', 0.93, true),
  rule(/\b(?:easy to (?:set up|configure)|simple to (?:set up|configure)|(?:a )?(?:much )?simpler setup|setup (?:was|is) (?:easy|simple|quick)|set up in (?:minutes|no time))\b/gi, 'praise', 'The experience feels easy to start', 'setup complexity', 'positive', 'relief', 0.93, true),
  rule(/\b(?:friendly staff|staff (?:were|was|are|is) (?:friendly|kind|lovely|helpful|welcoming)|kind and helpful staff)\b/gi, 'praise', 'Staff make customers feel welcome', 'staff friendliness', 'positive', 'trust', 0.96, true),
  rule(/\b(?:support (?:was|is|were) (?:fast|quick|responsive|helpful)|fast support|quick support|support replied (?:quickly|immediately)|support responded (?:quickly|immediately))\b/gi, 'praise', 'Support responds quickly', 'support speed', 'positive', 'confidence', 0.95, true),
  rule(/\b(?:worth (?:it|the (?:money|price)|every penny)|great value|good value|fair price|value for money)\b/gi, 'praise', 'Customers see strong value for the price', 'price and value', 'positive', 'satisfaction', 0.94, true),
  rule(/\b(?:just works|works? (?:perfectly|reliably|every time)|rock[- ]solid|never lets? (?:me|us) down|reliable and stable)\b/gi, 'praise', 'The product works reliably', 'reliability', 'positive', 'confidence', 0.95, true),
  rule(/\b(?:clear documentation|excellent documentation|helpful documentation|instructions (?:were|are) clear|well documented)\b/gi, 'praise', 'Documentation makes progress clear', 'documentation', 'positive', 'confidence', 0.94, true),
  rule(/\b(?:spotlessly clean|spotless|very clean|clean and tidy|immaculately clean)\b/gi, 'praise', 'Customers notice the cleanliness', 'cleanliness', 'positive', 'satisfaction', 0.95, true),
  rule(/\b(?:delivery (?:was|is) (?:fast|quick|on time)|fast delivery|quick delivery|arrived (?:early|on time|quickly))\b/gi, 'praise', 'Delivery meets or beats expectations', 'delivery', 'positive', 'satisfaction', 0.94, true),
]

const intentRules: Rule[] = [
  rule(/\b(?:I|we) (?:wanted|needed|was looking for|were looking for) (?:something|a (?:tool|solution|service))?\s*(?:that was |that is |to be )?(?:simple|easy|reliable|fast|quick|straightforward)\b/gi, 'desired_outcome', 'Customers want a simpler, dependable outcome', 'ease and reliability', 'neutral', 'hope', 0.88),
  rule(/\b(?:I|we) (?:chose|picked|bought|switched to|signed up for) (?:it|this|them|\w+(?:\s+\w+){0,2}) because [^.?!;]+/gi, 'purchase_trigger', 'A specific benefit triggered the purchase', 'purchase motivation', 'positive', 'confidence', 0.86),
  rule(/\b(?:please (?:add|include|support|allow)|wish (?:it|this) (?:had|included|supported|allowed)|would like (?:a|an|the|to) [^.?!;]+|needs? (?:a|an) [\w -]+ feature)\b/gi, 'feature_request', 'Customers request additional capability', 'feature request', 'neutral', 'hope', 0.88),
  rule(/\b(?:unlike|compared (?:with|to)|better than|worse than) (?:other (?:tools|products|services|options)|our old (?:tool|provider)|[A-Z][\w.-]+)\b/g, 'competitor_mention', 'Customers compare the experience with alternatives', 'competitive comparison', 'mixed', undefined, 0.82),
]

const emotionRules: Rule[] = [
  rule(/\b(?:frustrated|frustrating|annoyed|exhausted|overwhelmed)\b/gi, 'emotion', 'Customers express frustration', 'customer emotion', 'negative', 'frustration', 0.92),
  rule(/\b(?:relieved|a relief|peace of mind)\b/gi, 'emotion', 'Customers express relief', 'customer emotion', 'positive', 'relief', 0.93),
  rule(/\b(?:confident|reassured|felt secure)\b/gi, 'emotion', 'Customers express confidence', 'customer emotion', 'positive', 'confidence', 0.9),
  rule(/\b(?:disappointed|disappointing|let down)\b/gi, 'emotion', 'Customers express disappointment', 'customer emotion', 'negative', 'disappointment', 0.92),
]

function rule(
  pattern: RegExp,
  signalType: SignalType,
  label: string,
  normalizedAspect: string,
  sentiment: SignalSentiment,
  emotion: string | undefined,
  confidence: number,
  skipWhenNegated = false,
): Rule {
  return { pattern, signalType, label, normalizedAspect, sentiment, emotion, confidence, skipWhenNegated }
}

function isNegated(text: string, start: number): boolean {
  const prefix = text.slice(Math.max(0, start - 18), start)
  return /(?:\bnot|never|hardly|isn['’]t|wasn['’]t|weren['’]t|don['’]t|doesn['’]t|didn['’]t)\s+(?:really\s+|very\s+)?$/i.test(prefix)
}

function matchRules(text: string, rules: Rule[]): SignalCandidate[] {
  const candidates: SignalCandidate[] = []

  for (const definition of rules) {
    const flags = definition.pattern.flags.includes('g') ? definition.pattern.flags : `${definition.pattern.flags}g`
    const pattern = new RegExp(definition.pattern.source, flags)
    for (const match of text.matchAll(pattern)) {
      const quoteStart = match.index
      if (quoteStart === undefined || !match[0] || (definition.skipWhenNegated && isNegated(text, quoteStart))) continue
      const quoteEnd = quoteStart + match[0].length
      candidates.push({
        signalType: definition.signalType,
        label: definition.label,
        normalizedAspect: definition.normalizedAspect,
        sentiment: definition.sentiment,
        ...(definition.emotion ? { emotion: definition.emotion } : {}),
        confidence: definition.confidence,
        quoteText: text.slice(quoteStart, quoteEnd),
        quoteStart,
        quoteEnd,
        attributes: { extractorVersion: SIGNAL_EXTRACTOR_VERSION },
      })
    }
  }
  return candidates
}

function compareCandidates(left: SignalCandidate, right: SignalCandidate): number {
  return left.quoteStart - right.quoteStart
    || left.quoteEnd - right.quoteEnd
    || left.signalType.localeCompare(right.signalType)
    || left.normalizedAspect.localeCompare(right.normalizedAspect)
}

function candidateKey(candidate: SignalCandidate): string {
  return `${candidate.quoteStart}:${candidate.quoteEnd}:${candidate.signalType}:${candidate.normalizedAspect}`
}

export function extractSignalsFromReview(review: SignalExtractionReview): ExtractedSignal[] {
  const text = review.text ?? ''
  if (!text.trim()) return []

  const seen = new Set<string>()
  const candidates = [
    ...matchRules(text, negativeRules),
    ...matchRules(text, positiveRules),
    ...matchRules(text, intentRules),
    ...matchRules(text, emotionRules),
  ]
    .sort(compareCandidates)
    .filter((candidate) => {
      const key = candidateKey(candidate)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

  return candidates.map((candidate, index) => {
    const ordinal = index + 1
    return {
      ...candidate,
      id: `${review.reviewId}:signal:${ordinal}`,
      ordinal,
      reviewId: review.reviewId,
      attributes: {
        ...candidate.attributes,
        ...(review.rating == null ? {} : { rating: review.rating }),
        ...(review.language ? { language: review.language } : {}),
        ...(review.entity ? { entity: review.entity } : {}),
        ...(review.sourceCreatedAt ? { sourceCreatedAt: review.sourceCreatedAt instanceof Date ? review.sourceCreatedAt.toISOString() : review.sourceCreatedAt } : {}),
      },
    }
  })
}

export function extractSignals(reviews: SignalExtractionReview[]): ExtractedSignal[] {
  return reviews.flatMap(extractSignalsFromReview)
}

const adaptiveStopWords = new Set([
  'about', 'after', 'again', 'also', 'another', 'arrived', 'because', 'before', 'being', 'could', 'didn',
  'doesn', 'every', 'felt', 'from', 'good', 'great', 'have', 'just', 'made', 'minute', 'more', 'much', 'only', 'order',
  'ordered', 'other', 'really', 'restaurant', 'same', 'should', 'still', 'than', 'that', 'their', 'there',
  'they', 'this', 'today', 'very', 'waited', 'were', 'when', 'where', 'which', 'while', 'with', 'would', 'your',
])

function adaptiveKey(value: string) {
  const normalized = value.normalize('NFKC').toLocaleLowerCase('en-US').replace(/[’']/g, '')
  return normalized.length > 5 && normalized.endsWith('s') && !normalized.endsWith('ss')
    ? normalized.slice(0, -1)
    : normalized
}

function adaptiveTokens(text: string) {
  return [...text.matchAll(/[\p{L}\p{M}][\p{L}\p{M}’'-]{3,}/gu)]
    .map((match) => ({ text: match[0], key: adaptiveKey(match[0]), start: match.index ?? 0 }))
    .filter((token) => !adaptiveStopWords.has(token.key))
}

export function extractAdaptiveSignals(
  reviews: SignalExtractionReview[],
  existingSignals: readonly ExtractedSignal[] = extractSignals(reviews),
): ExtractedSignal[] {
  const minimumFrequency = Math.max(3, Math.ceil(reviews.length * 0.03))
  const reservedAspects = new Set(existingSignals.map((signal) => adaptiveKey(signal.normalizedAspect)))
  const documents = new Map<string, Set<string>>()
  for (const review of reviews) {
    const unique = new Set(adaptiveTokens(review.text ?? '').map((token) => token.key))
    for (const key of unique) {
      const reviewIds = documents.get(key) ?? new Set<string>()
      reviewIds.add(review.reviewId)
      documents.set(key, reviewIds)
    }
  }
  const aspects = new Set([...documents.entries()]
    .filter(([key, reviewIds]) => !reservedAspects.has(key) && reviewIds.size >= minimumFrequency && reviewIds.size <= Math.max(3, Math.ceil(reviews.length * 0.4)))
    .sort((left, right) => right[1].size - left[1].size || left[0].localeCompare(right[0]))
    .slice(0, 12)
    .map(([key]) => key))
  const occupied = new Map<string, Array<{ start: number; end: number }>>()
  for (const signal of existingSignals) {
    const spans = occupied.get(signal.reviewId) ?? []
    spans.push({ start: signal.quoteStart, end: signal.quoteEnd })
    occupied.set(signal.reviewId, spans)
  }

  return reviews.flatMap((review) => {
    const text = review.text ?? ''
    const spans = occupied.get(review.reviewId) ?? []
    const seen = new Set<string>()
    return adaptiveTokens(text)
      .filter((token) => {
        if (!aspects.has(token.key) || seen.has(token.key) ||
          spans.some((span) => token.start < span.end && token.start + token.text.length > span.start)) return false
        seen.add(token.key)
        return true
      })
      .slice(0, 3)
      .map((token, index) => {
        const rating = review.rating
        const negative = typeof rating === 'number' && rating <= 2
        const positive = typeof rating === 'number' && rating >= 4
        const signalType: SignalType = negative ? 'pain_point' : positive ? 'praise' : 'product_aspect'
        const documentFrequency = documents.get(token.key)?.size ?? 0
        return {
          id: `${review.reviewId}:adaptive:${index + 1}`,
          ordinal: index + 1,
          reviewId: review.reviewId,
          signalType,
          label: `Customers repeatedly mention ${token.key}`,
          normalizedAspect: token.key,
          sentiment: negative ? 'negative' : positive ? 'positive' : 'neutral',
          confidence: Math.min(0.85, 0.62 + (documentFrequency / Math.max(reviews.length, 1))),
          quoteText: text.slice(token.start, token.start + token.text.length),
          quoteStart: token.start,
          quoteEnd: token.start + token.text.length,
          attributes: {
            extractorVersion: SIGNAL_EXTRACTOR_VERSION,
            extractionMode: 'adaptive_frequency',
            documentFrequency,
            ...(rating == null ? {} : { rating }),
            ...(review.language ? { language: review.language } : {}),
            ...(review.entity ? { entity: review.entity } : {}),
          },
        } satisfies ExtractedSignal
      })
  })
}
