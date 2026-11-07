# Improve locale copying and visibility into default changes

Status: implemented (unreleased).

The [locale guide](../locales.md) documents the implemented copy, source review,
existing-locale linking, permission boundaries and migration behavior.
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

## Implementation

A private source baseline and explicit block mapping distinguish source changes
from intentional translations. Existing locales require explicit section matching;
no migration guesses their history. Safe field changes and new sections can be
selected together; structural changes and translation conflicts require a choice.
Keeping a locale version acknowledges only that source change. Page and scoped
block reviews use the same dialog, transactional commands, permissions and locks.

## Verification

Add focused tests for root-field copying, source changes after copying, local
layout divergence, acknowledgement, and recipient permissions. Exercise the flow
with keyboard access and responsive layouts. Confirm default edits leave localized
drafts and publications unchanged, and copying cannot publish source drafts.

References: [locale product decision](product-direction.md#independent-locale-pages-are-intentional),
[current import UI](../../apps/web/src/features/editor/story-workspace.tsx),
[import command and history](../../packages/db/src/store.ts), and
[existing independence coverage](../../packages/db/src/store.test.ts).
