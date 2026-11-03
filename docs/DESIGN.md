# Design

## The idea

MMost apps that identify things give a short answer without showing how they reached it. I SEE works differently: it uses the photograph as evidence and connects each explanation to the exact part of the image or the source of the information. Its design is inspired by scientific illustrations and museum displays. It shows the photograph on a simple background, with numbered parts, lines pointing to specific details in the image, and a guide explaining what each line means.

## Meta's palette, used the way Meta uses it

| Token | Value | Use |
|---|---|---|
| `--action` | Meta Blue `#0064E0` (dark: `#47A5FA`) | Actions only: primary buttons, links, the selected region |
| `--ink` | `#1C2B33` | Text |
| `--ink-2` | `#5D6C7B` | Secondary text |
| `--surface` | `#F1F4F7` | Quiet fills |
| `--plate` | Linen `#F2F0E6` | The ground photographs sit on |
| darkroom | `#111213` / `#1C1E21` | The immersive scanning view |
| status | `#31A24C`, `#F7B928`, `#E41E3F` | Reserved for state, always with an icon and a word |

Principles taken from Meta's design language: photography first; binary surfaces (white for
information, near-black for immersive moments); blue reserved for action; pill buttons;
generous whitespace; 150/200 ms motion on `cubic-bezier(0.2, 0, 0, 1)`. Meta's typeface
(Optimistic) is proprietary and not used; no Meta logos are used.

## Evidence encoding

Six grades, each with a word, a glyph, a line pattern and a colour, so no meaning depends on
colour alone.

| Grade | Glyph | Line | Colour (light / dark) |
|---|---|---|---|
| Seen | filled disc | solid | teal `#0B8A78` / `#1F9C88` |
| Cited | diamond | solid | grape `#7B4AE2` / `#9278F0` |
| Reasoned | half disc | dashed 7·5 | tomato `#C2541E` / `#D96C3A` |
| Guess | dotted ring | dotted 1.5·5 | tomato |
| Unknown | struck ring | none | grey `#6E7F8F` |
| Yours | pen | none | ink |

The three hues were run through a colour-vision validator (lightness band, chroma floor,
deuteranopia/protanopia/tritanopia separation, normal-vision separation, 3:1 contrast) in
both themes and pass all checks. Reasoned and Guess share a hue on purpose: both mean "not
directly evidenced", and they differ by glyph, line and word.

Confidence is never shown as a percentage, because model confidence is not calibrated. A
short bar shows the model's estimate with a tick at the ceiling allowed for that grade, and
a word (Strong, Moderate, Weak). Candidate shares are shown as percentages with an explicit
note that they are rough estimates.

## Type

- **Atkinson Hyperlegible Next** (Braille Institute) for the interface: designed for low
  vision, which matters for an app people will point at labels and small parts.
- **Literata** for the profile's own voice: object names and summaries, in italic.
- **JetBrains Mono** only for traces, expressions and model ids.

All self-hosted, Latin subsets only.

## Layout

- **Home**: the hero is a live plate with three annotated parts, one of them a hidden part
  (the gasket) that is Cited, not Seen; then the evidence key as a specimen table; then the
  ambiguous fitting, showing the contest and the photo that would settle it; then the model
  roster.
- **Darkroom** (always dark): the photo with outlines drawing in as SAM returns them,
  candidates updating live, and the pipeline with the model that did each stage.
- **Workspace**: the plate stays pinned on the left; the ledger scrolls on the right. Hovering
  a sentence spotlights its regions and draws a leader line, in that grade's line pattern,
  from the sentence to the part.

## Accessibility

Keyboard reachable throughout (plate markers are buttons with spoken positions such as
"safety valve, small area at lower left"), 3 px focus ring, `aria-live` for pipeline progress,
reduced-motion honoured (and a setting to force it), large-text and bold-contrast settings,
tables as alternatives to charts, 16 px phone gutter, no horizontal scroll (checked by
`scripts/e2e.cjs` at 390 px).

## What was deliberately avoided

Gradients for decoration, glassmorphism, emoji, sparkle icons, "AI-powered" copy, generic
three-card feature grids, dashboards of meaningless numbers, and any picture that could be
mistaken for the person's own object.
