'use client';
import { useState } from 'react';
import type {
  CheckpointDetail,
  PublicationReferenceChoice,
  PublicationReview,
} from '@storypane/core';
import { Button, ErrorNotice, Modal } from '@storypane/ui';
import { api, errorMessage } from './api';

export function publicationSelection(
  review: PublicationReview | null,
  choices: PublicationReferenceChoice[],
) {
  const active = new Set(review ? [review.snapshot.locale.id] : []);
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const reference of review?.references ?? []) {
      if (
        !active.has(reference.localeId) &&
        reference.usages.some((usage) => active.has(usage.localeId)) &&
        choices.some(
          (choice) => choice.localeId === reference.localeId && choice.action === 'publish',
        )
      ) {
        active.add(reference.localeId);
        expanded = true;
      }
    }
  }
  const references = (review?.references ?? [])
    .filter((reference) => reference.usages.some((usage) => active.has(usage.localeId)))
    .map((reference) => ({
      ...reference,
      usages: reference.usages.filter((usage) => active.has(usage.localeId)),
      canOmit: reference.usages
        .filter((usage) => active.has(usage.localeId))
        .every((usage) => usage.canOmit),
    }));
  return {
    references,
    choices: choices.filter((choice) =>
      references.some((reference) => reference.localeId === choice.localeId),
    ),
    complete:
      !!review &&
      references.every((reference) =>
        choices.some(
          (choice) =>
            choice.localeId === reference.localeId &&
            choice.checkpointId === reference.checkpointId &&
            (choice.action === 'publish' ? reference.canPublish : reference.canOmit),
        ),
      ),
  };
}

export function PublicationReferences({
  review,
  choices,
  onChange,
  disabled,
}: {
  review: PublicationReview;
  choices: PublicationReferenceChoice[];
  onChange: (choices: PublicationReferenceChoice[]) => void;
  disabled?: boolean;
}) {
  const { references } = publicationSelection(review, choices);
  const [checkpoint, setCheckpoint] = useState<CheckpointDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!references.length) return null;
  return (
    <section className="publication-references" aria-label="Unpublished linked stories">
      <h3>Unpublished linked stories</h3>
      <p>
        Choose what goes live with this page. Omitted references stay in your draft. Linked stories
        with a live version keep using that version.
      </p>
      <ErrorNotice message={error} />
      {references.map((reference) => (
        <div className="publication-reference" key={reference.localeId}>
          <div className="publication-reference-info">
            <strong>{reference.storyName}</strong>
            <span className="small muted">
              {reference.localeName} · Saved revision {reference.revision}
            </span>
            <span className="small muted">
              Used by{' '}
              {Array.from(
                new Set(reference.usages.map((usage) => `${usage.storyName} · ${usage.field}`)),
              ).join(', ')}
            </span>
            <Button
              className="button--small"
              variant="ghost"
              onClick={() => {
                setError(null);
                void api<CheckpointDetail>(
                  `/stories/${reference.storyId}/locales/${reference.localeId}/checkpoints/${reference.checkpointId}`,
                )
                  .then(setCheckpoint)
                  .catch((error) => setError(errorMessage(error)));
              }}
            >
              Inspect saved content
            </Button>
          </div>
          <div className="publication-reference-choice">
            <label>
              <span className="small">
                Action for {reference.storyName} ({reference.localeName})
              </span>
              <select
                disabled={disabled}
                value={
                  choices.find((choice) => choice.localeId === reference.localeId)?.action ?? ''
                }
                onChange={(event) =>
                  onChange([
                    ...choices.filter((choice) => choice.localeId !== reference.localeId),
                    {
                      localeId: reference.localeId,
                      checkpointId: reference.checkpointId,
                      action: event.target.value as PublicationReferenceChoice['action'],
                    },
                  ])
                }
              >
                <option value="" disabled>
                  Choose an action…
                </option>
                <option value="publish" disabled={!reference.canPublish}>
                  Publish this revision too
                </option>
                <option value="omit" disabled={!reference.canOmit}>
                  Omit from this publication
                </option>
              </select>
            </label>
            {!reference.canPublish && (
              <span className="small muted">You do not have permission to publish this story.</span>
            )}
            {!reference.canOmit && (
              <span className="small muted">A required reference cannot be omitted.</span>
            )}
          </div>
        </div>
      ))}
      <Modal
        open={!!checkpoint}
        onClose={() => setCheckpoint(null)}
        title={`${checkpoint?.snapshot.story.name ?? ''} · Saved revision ${checkpoint?.revision ?? ''}`}
      >
        <pre className="read-only-json">{JSON.stringify(checkpoint?.content, null, 2)}</pre>
      </Modal>
    </section>
  );
}
