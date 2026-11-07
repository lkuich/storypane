# Improve locale copying and visibility into default changes

Status: open; implementation not started.
Recorded: 2026-11-06.

## Problem

Independent locale pages are intentional: editors need to translate content and
adapt layouts for their market. Importing selected blocks from default provides
a starting point, but excludes page root fields such as metadata. Re-importing
appends new copies rather than updating existing ones. Later source corrections
can therefore be missed or require manual comparison across locales.

## Intended outcome

Make initial copying easier and help editors identify default-locale changes that
may need attention, while preserving independent content, layouts, and publishing.
This is an editor usability issue, not a request for field-level translations or
automatic synchronization.

## Scope and acceptance criteria

- Provide an explicit way to copy applicable default root fields when starting a
  locale, alongside the existing block-copy workflow. Show what will be copied;
  preserve the target locale's identity, URL, and publication state.
- Do not silently replace existing localized values or add duplicate blocks when
  an editor is trying to review source changes. Keep adding independent copies
  distinct from reviewing updates.
- Help editors see which default changes occurred since their copy or last review,
  without treating deliberate local differences as errors. Let editors acknowledge
  changes they choose not to apply.
- Default edits must never overwrite local content, reorder its layout, or publish
  a locale. Any applied changes remain local drafts until explicitly published.
- Apply existing read/edit scopes to copying and change visibility; restricted
  source values must not appear in comparisons or copied content.

## Implementation decisions still needed

Determine the smallest useful comparison and how to retain its source baseline.
Current imports use fresh block IDs and do not establish persistent source-to-copy
mapping; timestamps alone cannot identify corresponding blocks after layouts
diverge. Decide whether page-level change awareness is sufficient before adding
block-level tracking or selective update controls. Define how existing locale
copies establish a baseline without inventing historical correspondence.

Reuse existing locale tabs, import controls, history, and review UI where practical.
No translation service, marketplace, or general workflow framework is required.

## Verification when implemented

Add focused tests for root-field copying, source changes after copying, local
layout divergence, acknowledgement, and recipient permissions. Exercise the flow
with keyboard access and responsive layouts. Confirm default edits leave localized
drafts and publications unchanged, and copying cannot publish source drafts.

References: [locale product decision](product-direction.md#independent-locale-pages-are-intentional),
[current import UI](../../apps/web/src/features/editor/story-workspace.tsx),
[import command and history](../../packages/db/src/store.ts), and
[existing independence coverage](../../packages/db/src/store.test.ts).
