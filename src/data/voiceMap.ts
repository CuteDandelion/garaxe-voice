export type Evidence = {
  id: string
  quote: string
  source: string
  rating: number
  date: string
  theme: string
}

export const voiceMap = {
  project: 'Acme Software',
  period: 'Jul 2025 – Jul 2026',
  updated: 'Jul 12, 2026',
  reviewCount: 1284,
  sourceCount: 6,
  confidence: 'High',
  conclusion: 'Your customers are not buying convenience. They are buying relief from complexity.',
  interpretation:
    'Across 1,284 reviews, customers repeatedly describe feeling exhausted by tools that require too much configuration. “It just works” is not merely praise — it is the central purchasing motivation.',
  signals: [
    ['Primary pain', 'Configuration fatigue'],
    ['Desired outcome', 'Confidence without technical effort'],
    ['Biggest objection', 'Doubt it will work for my specific situation'],
    ['Core emotional driver', 'Relief and peace of mind'],
  ],
  primaryPain: {
    quote: 'Every other solution required too much setup.',
    summary:
      'Customers do not describe the problem as a lack of functionality. They describe the cognitive cost of configuring and maintaining existing alternatives.',
    supportingReviews: 184,
  },
  phrases: [
    ['too much setup', 63],
    ['just wanted it to work', 41],
    ['wasted weeks', 27],
    ['hard to configure', 22],
    ['complicated for no reason', 19],
  ],
  journey: [
    ['Frustration', 'Current tools are too complicated'],
    ['Investigation', 'Looking for simpler alternatives'],
    ['Doubt', 'Not sure it will work for their use case'],
    ['Proof', 'Sees results quickly with low effort'],
    ['Relief', 'Finally found a tool they can trust'],
  ],
  moves: [
    ['Messaging', 'Lead with relief, not feature depth'],
    ['Product', 'Reduce decisions during setup'],
    ['Sales', 'Address niche fit with specific proof'],
    ['Onboarding', 'Show value before configuration'],
  ],
  sources: [
    ['G2', '381 reviews'],
    ['Trustpilot', '624 reviews'],
    ['Capterra', '156 reviews'],
    ['Google Reviews', '87 reviews'],
    ['CSV Upload', '36 reviews'],
    ['Interviews', '10 responses'],
  ],
} as const

export const evidence: Evidence[] = [
  {
    id: 'ev-1',
    quote: 'I just wanted something that worked without having to think about it.',
    source: 'G2',
    rating: 5,
    date: '2026-06-18',
    theme: 'Configuration fatigue',
  },
  {
    id: 'ev-2',
    quote: 'We spent weeks trying to set it up. Finally found something that just works.',
    source: 'Trustpilot',
    rating: 4,
    date: '2026-05-29',
    theme: 'Configuration fatigue',
  },
  {
    id: 'ev-3',
    quote: 'Every other solution required too much setup for a team our size.',
    source: 'Capterra',
    rating: 5,
    date: '2026-04-12',
    theme: 'Configuration fatigue',
  },
]
