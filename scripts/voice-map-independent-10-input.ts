export type IndependentHoldoutInput = { id: string; text: string; sourceUrl: string }

// Consent-safe synthetic public-style feedback, authored before the first run.
// Gold categories and grouping expectations live in the separate rubric file.
const texts = [
  'The grocery picker ignored my nut-free substitution setting and replaced the cereal with one containing almonds.',
  'A substitute snack contained peanuts even though the order profile marked nut ingredients as unsafe.',
  'Let me reserve an available bike dock near the station before the evening commute begins.',
  'I want to hold a return dock for ten minutes so the ride does not end with a full rack.',
  'I would not install the apartment energy monitor until the landlord permission requirement is explicit.',
  'The sensor is a nonstarter for renters unless the building owner can approve installation first.',
  'I felt panicked after transferring the concert ticket because neither person received a confirmation.',
  'The silent ticket handoff left me uneasy; neither account showed where the pass had gone.',
  'Which spoken languages are available in the museum audio guide for the permanent collection?',
  'Does the gallery audio tour publish a complete language list before a visitor downloads it?',
]

export const independentHoldoutInput: IndependentHoldoutInput[] = texts.map((text, index) => ({
  id: `independent-${String(index + 1).padStart(2, '0')}`,
  text,
  sourceUrl: `https://example.invalid/independent-public-feedback/${String(index + 1).padStart(2, '0')}`,
}))
