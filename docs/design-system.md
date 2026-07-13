# Design System

Status: Approved visual direction
Last updated: 2026-07-13

## North star

`Premium editorial research report x practical software.` The interface should feel quiet, confident, warm, spacious, text-led, evidence-driven, and slightly unconventional.

Primary application reference: `docs/reference-assets/garaxe-voice-of-customer/dashboard-primary-reference.png` (1536x1024).

Brand-system source: `https://garaxe.com/voice-of-customer`. Local captures and source assets are in `docs/reference-assets/garaxe-voice-of-customer/`.

The image governs application composition, information density, and hierarchy. The live page governs brand color, rules, restraint, utility typography, and tone. If they conflict, preserve the image's product hierarchy while expressing it with the live Garaxe tokens.

## Tokens

Initial tokens must be visually calibrated against the captured stylesheet before implementation:

```css
--paper: #efebe0;
--surface: #fbfaf6;
--ink: #0a0a0a;
--muted: #68665f;
--rule: #0a0a0a;
--accent: #f5974d;
--danger: #a33b2e;
--success: #426a4d;
--warning: #b9832f;
```

Typography uses three deliberate roles:

- Editorial serif for the primary conclusion, customer quotations, project name, and large evidence counts. Select one production-licensed high-contrast serif after visual comparison; do not silently substitute a default browser serif.
- Space Grotesk for section titles, compact emphasis, and Garaxe brand continuity.
- Inter for controls, body, metadata, navigation, tables, and evidence details.

Labels use 11-13px uppercase with generous tracking. Body is 16-18px. Quotes are 24-32px. Main conclusions scale from 44px mobile to 72px desktop.

## Composition

- Desktop uses the reference's four-part shell: 232px project rail, compact global top bar, horizontal analysis navigation, and a content region split into a dominant editorial canvas plus a 300px-340px supporting rail.
- The project rail is light and quiet, never a dominant dark sidebar. It contains an authorized-project selector with a separate create action, primary destinations, a restrained dataset-confidence card, and the authenticated identity plus explicit Log out action at the bottom.
- The global top bar contains a second synchronized project selector, an evidence-window control that exposes exact From/To dates, export action, and an identity menu with full email and logout. It must not become a dense command center.
- The horizontal analysis navigation starts with Voice Map, followed by Pain Phrases, Outcomes, Objections, Triggers, and Copy Lab; the active item uses a dark label and short muted-green underline.
- The primary canvas begins with an asymmetric two-column statement: editorial conclusion on the left, concise interpretation and methodology link on the right.
- The supporting rail contains Executive Signals, Top Customer Quotes, and Sources Included. These panels remain secondary to the main conclusion.
- Use strong horizontal rules, large whitespace, thin borders, minimal shadow, and square or subtly rounded corners.
- Cards are reserved for true objects: quote, action, source, copy line, or saved report.
- Opening view leads with a conclusion, not KPI tiles.

## Voice Map Read anatomy

The primary reference defines the desktop overview sequence:

1. Global/project shell and analysis tabs.
2. Executive conclusion plus interpretation.
3. Compact evidence metadata row: review count, source count, confidence, update time.
4. Primary-pain story with large quote, explanation, supporting-review count, and evidence action.
5. The top eight evidence buckets as bubbles labeled with the bucket name and sized from independent supporting-review count on a bounded/log scale. Low-velocity movement uses boundary bounce and circle collision resolution; it pauses during interaction and becomes a static packed layout for reduced motion. Retain an accessible category legend and semantic table fallback.
6. Dominant journey as a left-to-right progression.
7. Recommended moves grouped by Messaging, Product, Sales, and Onboarding.
8. Supporting right rail for signals, quotes, and source inventory.

This is a hierarchy contract, not fixed sample content. Real data may add or remove modules, but it may not degrade into a uniform card grid.

## Density and geometry

- Main shell padding: approximately 28-40px desktop; 20-24px tablet; 16-20px mobile.
- Borders are 1px low-contrast warm gray; primary rules use ink sparingly.
- Panel radii remain subtle, approximately 4-8px.
- Selected navigation may use a warm-gray wash; avoid saturated fills.
- Icon containers are circular only where the reference uses them for executive signals or journey steps.
- The muted green is reserved for the emphasized word, confidence dot, and active underline. Orange/coral marks pain evidence and should not become a general brand fill.

## Read and Investigate

- Read: narrative Voice Map for founders, operators, marketers, and sharing.
- Investigate: filters, comparisons, raw evidence, confidence, diagnostics, and curation.
- Preserve URL-addressable state so evidence and theme views can be shared.

## Core components

- Editorial insight header with compact metadata.
- Numbered signal block with interpretation and evidence count.
- Large quote block with provenance and analysis tags.
- Evidence drawer with the full immutable original comment, highlighted exact span, source metadata, traversal, and confidence detail. Compact excerpts may label the match but never replace the source comment.
- Ranked theme index with representative customer phrase.
- Analysis progress narrative with completed/current/pending stages.
- Source inventory table for operational workflows.

## Visualization rules

Use charts only where they materially clarify change, comparison, or distribution. Prefer ranked lists, sparklines, small multiples, timelines, and location comparison tables. Avoid word clouds, decorative donuts, 3D, gauges, and excessive semantic colors.

The bucket field is not a word cloud: each bubble is a validated theme, its visible label is a descriptive multi-word bucket name, area follows bounded/log independent-review support, and selecting it opens the full source evidence. Long sample feedback and isolated context tokens must never be substituted for the bucket label. Label type scales from 8.5px on the smallest bubble to 12.5px on the largest. Use responsive SVG/DOM; do not add WebGL. Motion is clearly perceptible but controlled, uses collision resolution, pauses on hover/focus/tap, and becomes a static packed layout under `prefers-reduced-motion`.

## Motion

Use motion for orientation, continuity, and feedback: drawer entrance, filter result transition, stage progression, and theme-to-evidence continuity. No ambient WebGL in the application shell. Honor `prefers-reduced-motion`; content and hierarchy must remain complete with animation disabled.

## Responsive and accessibility

- Support 390px without horizontal overflow.
- At tablet widths, collapse the project rail to an explicit drawer and move the supporting rail below the primary canvas.
- At mobile widths, stack conclusion and interpretation, replace horizontal analysis tabs with a scrollable tablist/menu, turn the journey into a vertical sequence, and keep evidence actions adjacent to their claims.
- Toolbars wrap; tables switch to stacked records or deliberate horizontal regions.
- Focus indicators meet contrast requirements.
- Quotes, charts, confidence, and sentiment never depend on color alone.
- Drawers behave as full-screen dialogs on small screens with focus trapping and restoration.

## Anti-patterns

No generic dashboard KPI grid, permanent dark nav, glassmorphism, rainbow sentiment palette, decorative gradients, oversized rounded cards, chatbot-first Copy Lab, or AI claims without visible evidence access. Do not imitate the reference by hardcoding its sample numbers, project name, or quotes.
