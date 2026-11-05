import { describe, expect, it } from 'vitest';
import type { PublicationReview, PublicationReferenceChoice } from '@storypane/core';
import { publicationSelection } from './publication-references';

const review = {
  snapshot: { locale: { id: 'home' } },
  references: [
    {
      localeId: 'footer',
      checkpointId: 'footer-revision',
      canPublish: true,
      usages: [{ localeId: 'home', canOmit: true }],
    },
    {
      localeId: 'nested',
      checkpointId: 'nested-revision',
      canPublish: true,
      usages: [{ localeId: 'footer', canOmit: false }],
    },
  ],
} as PublicationReview;
const choice = (
  localeId: string,
  action: PublicationReferenceChoice['action'],
): PublicationReferenceChoice => ({ localeId, checkpointId: `${localeId}-revision`, action });

describe('publication selections', () => {
  it('requires choices for active dependencies and prunes choices beneath an omitted story', () => {
    expect(publicationSelection(review, []).complete).toBe(false);
    expect(publicationSelection(review, [choice('footer', 'publish')]).complete).toBe(false);
    expect(
      publicationSelection(review, [choice('footer', 'publish'), choice('nested', 'publish')])
        .complete,
    ).toBe(true);
    const omitted = publicationSelection(review, [
      choice('footer', 'omit'),
      choice('nested', 'publish'),
    ]);
    expect(omitted.complete).toBe(true);
    expect(omitted.choices).toEqual([choice('footer', 'omit')]);
  });
  it('does not enable publication for required omissions, denied permissions, or stale checkpoints', () => {
    expect(
      publicationSelection(review, [choice('footer', 'publish'), choice('nested', 'omit')])
        .complete,
    ).toBe(false);
    const restricted = structuredClone(review);
    restricted.references[0].canPublish = false;
    expect(
      publicationSelection(restricted, [choice('footer', 'publish'), choice('nested', 'publish')])
        .complete,
    ).toBe(false);
    expect(
      publicationSelection(review, [{ ...choice('footer', 'omit'), checkpointId: 'old' }]).complete,
    ).toBe(false);
  });
});
