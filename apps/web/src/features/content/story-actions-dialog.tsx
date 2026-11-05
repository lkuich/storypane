'use client';
import { useEffect, useRef, useState } from 'react';
import type {
  BulkStoryActionResult,
  CheckpointDetail,
  ContentFolder,
  LifecycleReview,
  Story,
  StoryAction,
  PublicationReview,
  PublicationReferenceChoice,
} from '@storypane/core';
import { Button, ErrorNotice, Field, Loading, Modal } from '@storypane/ui';
import { api, errorMessage, jsonRequest } from '../editor/api';
import { PublicationReferences, publicationSelection } from '../editor/publication-references';

async function publicationReviewsFor(reviews: LifecycleReview[]) {
  const entries = await Promise.all(
    reviews.flatMap((review) =>
      review.locales
        .filter((locale) => locale.checkpointId)
        .map(async (locale) => {
          try {
            const publication = await api<PublicationReview>(
              `/stories/${review.story.id}/locales/${locale.id}/publication-review/${locale.checkpointId}`,
            );
            if (publication.snapshot.access?.publish === false)
              return {
                id: locale.id,
                publication: null,
                error: 'You do not have permission to publish this locale.',
              };
            return { id: locale.id, publication, error: null };
          } catch (error) {
            return { id: locale.id, publication: null, error: errorMessage(error) };
          }
        }),
    ),
  );
  return {
    reviews: Object.fromEntries(
      entries.flatMap((entry) => (entry.publication ? [[entry.id, entry.publication]] : [])),
    ),
    errors: Object.fromEntries(entries.map((entry) => [entry.id, entry.error])),
  };
}

export type StoryActionKind = StoryAction['action'];
export function StoryActionsDialog({
  stories,
  action,
  localeId,
  onClose,
  onComplete,
}: {
  stories: Story[];
  action: StoryActionKind;
  localeId?: string;
  onClose: () => void;
  onComplete: (ids: string[]) => void;
}) {
  const [reviews, setReviews] = useState<LifecycleReview[]>([]);
  const [folders, setFolders] = useState<ContentFolder[]>([]);
  const [folderId, setFolderId] = useState('');
  const [slug, setSlug] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [acknowledge, setAcknowledge] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<BulkStoryActionResult[]>([]);
  const [checkpoint, setCheckpoint] = useState<CheckpointDetail | null>(null);
  const [publicationReviews, setPublicationReviews] = useState<Record<string, PublicationReview>>(
    {},
  );
  const [publicationErrors, setPublicationErrors] = useState<Record<string, string | null>>({});
  const [referenceChoices, setReferenceChoices] = useState<
    Record<string, PublicationReferenceChoice[]>
  >({});
  const request = useRef<{ items: { storyId: string; input: StoryAction }[] } | null>(null);
  useEffect(() => {
    let stopped = false;
    Promise.all([
      Promise.all(stories.map((story) => api<LifecycleReview>(`/stories/${story.id}/review`))),
      api<ContentFolder[]>('/folders'),
    ])
      .then(async ([next, available]) => {
        const publications =
          action === 'publish' ? await publicationReviewsFor(next) : { reviews: {}, errors: {} };
        if (stopped) return;
        setPublicationReviews(publications.reviews);
        setPublicationErrors(publications.errors);
        setReviews(next);
        setFolders(available);
        setSelected(
          next.flatMap((review) =>
            review.locales
              .filter((locale) => !localeId || locale.id === localeId)
              .map((locale) => locale.id),
          ),
        );
      })
      .catch((error) => {
        if (!stopped) setError(errorMessage(error));
      });
    return () => {
      stopped = true;
    };
  }, [stories, localeId, action]);
  const localesRequired = action === 'publish' || action === 'unpublish';
  async function reviewFailures() {
    setBusy(true);
    setError(null);
    try {
      const failed = results.filter((result) => result.error);
      const next = await Promise.all(
        failed.map((result) => api<LifecycleReview>(`/stories/${result.storyId}/review`)),
      );
      const publications =
        action === 'publish' ? await publicationReviewsFor(next) : { reviews: {}, errors: {} };
      setPublicationReviews(publications.reviews);
      setPublicationErrors(publications.errors);
      setSelected((current) =>
        current.filter((id) =>
          next.some((review) => review.locales.some((locale) => locale.id === id)),
        ),
      );
      setReferenceChoices({});
      setReviews(next);
      setResults([]);
      request.current = null;
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  async function execute() {
    setBusy(true);
    setError(null);
    try {
      if (!request.current)
        request.current = {
          items: reviews
            .map((review) => {
              const common = { requestId: crypto.randomUUID() };
              let input: StoryAction;
              const locales = review.locales
                .filter((locale) => !localesRequired || selected.includes(locale.id))
                .map(({ id, checkpointId, publicationId }) => ({
                  id,
                  checkpointId,
                  publicationId,
                  ...(action === 'publish'
                    ? {
                        referenceChoices: publicationSelection(
                          publicationReviews[id] ?? null,
                          referenceChoices[id] ?? [],
                        ).choices,
                      }
                    : {}),
                }));
              if (action === 'publish' || action === 'unpublish')
                input = { ...common, action, locales, acknowledgeReferences: acknowledge };
              else if (action === 'delete') input = { ...common, action, locales };
              else if (action === 'restore') input = { ...common, action };
              else if (action === 'duplicate')
                input = {
                  ...common,
                  action,
                  folderId: folderId || null,
                  ...(slug && reviews.length === 1 ? { slug } : {}),
                };
              else
                input = {
                  ...common,
                  action,
                  location: {
                    folderId: folderId || null,
                    slug: review.story.slugSegment ?? review.story.slug.split('/').at(-1)!,
                    localeSlugs: Object.fromEntries(
                      review.locales
                        .filter((locale) => locale.slug)
                        .map((locale) => [locale.spaceLocaleId, locale.slugSegment]),
                    ),
                  },
                };
              return { storyId: review.story.id, input };
            })
            .filter((item) => !('locales' in item.input) || item.input.locales.length > 0),
        };
      const response = await api<BulkStoryActionResult[]>(
        '/stories/bulk',
        jsonRequest('POST', request.current),
      );
      setResults(response);
      const successful = response.filter((item) => item.result).map((item) => item.storyId);
      onComplete(successful);
      if (response.every((item) => item.result)) onClose();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      onClose={() => !busy && onClose()}
      title={`${action[0].toUpperCase() + action.slice(1)} ${stories.length === 1 ? stories[0].name : `${stories.length} stories`}`}
      description="Review these explicit selections. Each story succeeds or fails independently."
      wide
      className="story-actions-dialog"
    >
      <ErrorNotice message={error} />
      {!reviews.length && !error ? (
        <Loading label="Preparing review…" />
      ) : (
        <>
          {(action === 'move' || action === 'duplicate') && (
            <Field label="Destination folder" htmlFor="action-folder">
              <select
                id="action-folder"
                value={folderId}
                disabled={busy || !!request.current}
                onChange={(event) => setFolderId(event.target.value)}
              >
                <option value="">Space root</option>
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {action === 'duplicate' && stories.length === 1 && (
            <Field label="New slug (optional)" htmlFor="duplicate-slug">
              <input
                id="duplicate-slug"
                value={slug}
                disabled={busy || !!request.current}
                onChange={(event) => setSlug(event.target.value)}
                placeholder="An available copy slug is generated"
              />
            </Field>
          )}
          {action === 'delete' && (
            <p>
              Deleting removes all locales from delivery, cancels schedules, and closes previews.
              History is retained. Restore it from Deleted stories.
            </p>
          )}
          {action === 'restore' && (
            <p>Restore saved drafts under the current schema. They will remain unpublished.</p>
          )}
          {action === 'duplicate' && (
            <p>
              Copy every saved locale with new block IDs. References keep pointing at their original
              stories. Publications and history are not copied.
            </p>
          )}
          {reviews.map((review) => (
            <section className="story-action-review" key={review.story.id}>
              <h3>{review.story.name}</h3>
              {review.locales.map((locale) => (
                <div key={locale.id}>
                  <div className="story-action-locale">
                    {localesRequired && (
                      <input
                        type="checkbox"
                        aria-label={`${review.story.name}: ${locale.name}`}
                        checked={selected.includes(locale.id)}
                        disabled={busy || !!request.current}
                        onChange={(event) =>
                          setSelected((current) =>
                            event.target.checked
                              ? [...current, locale.id]
                              : current.filter((id) => id !== locale.id),
                          )
                        }
                      />
                    )}
                    <div className="story-action-locale-info">
                      <strong>{locale.name}</strong>
                      <code>
                        /
                        {[
                          locale.slug,
                          action === 'unpublish'
                            ? (locale.publishedUrlSlug ?? locale.urlSlug)
                            : locale.urlSlug,
                        ]
                          .filter(Boolean)
                          .join('/')}
                      </code>
                      <span>
                        Revision {locale.revision}
                        {locale.publicationId ? ' · Live' : ' · Unpublished'}
                      </span>
                    </div>
                    {action === 'publish' && locale.checkpointId && (
                      <Button
                        className="button--small"
                        onClick={() =>
                          void api<CheckpointDetail>(
                            `/stories/${review.story.id}/locales/${locale.id}/checkpoints/${locale.checkpointId}`,
                          )
                            .then(setCheckpoint)
                            .catch((error) => setError(errorMessage(error)))
                        }
                      >
                        Inspect saved content
                      </Button>
                    )}
                  </div>
                  {action === 'publish' && selected.includes(locale.id) && (
                    <ErrorNotice message={publicationErrors[locale.id] ?? null} />
                  )}
                  {action === 'publish' &&
                    selected.includes(locale.id) &&
                    publicationReviews[locale.id] && (
                      <PublicationReferences
                        review={publicationReviews[locale.id]}
                        choices={referenceChoices[locale.id] ?? []}
                        onChange={(choices) =>
                          setReferenceChoices((current) => ({ ...current, [locale.id]: choices }))
                        }
                        disabled={busy || !!request.current}
                      />
                    )}
                </div>
              ))}
              {!!review.incomingReferences.length && (
                <p>
                  {review.incomingReferences.length} incoming reference(s):{' '}
                  {review.incomingReferences.map((reference) => reference.storyName).join(', ')}
                  {action === 'delete' ? '. Remove these references before deleting.' : ''}
                </p>
              )}
            </section>
          ))}
          {action === 'unpublish' &&
            reviews.some((review) =>
              review.incomingReferences.some((reference) => reference.published),
            ) && (
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={acknowledge}
                  disabled={busy || !!request.current}
                  onChange={(event) => setAcknowledge(event.target.checked)}
                />{' '}
                I understand that published references may stop resolving.
              </label>
            )}
          {!!results.length && (
            <ul aria-live="polite">
              {results.map((result) => (
                <li key={result.storyId}>
                  {reviews.find((review) => review.story.id === result.storyId)?.story.name}:{' '}
                  {result.error?.message ?? 'Completed'}
                </li>
              ))}
            </ul>
          )}
          <div className="dialog-actions">
            {results.some((result) => result.error) && (
              <Button disabled={busy} onClick={() => void reviewFailures()}>
                Review failed selections again
              </Button>
            )}
            <Button disabled={busy} onClick={onClose}>
              Close
            </Button>
            <Button
              variant={action === 'delete' || action === 'unpublish' ? 'danger' : 'primary'}
              disabled={
                busy ||
                !reviews.length ||
                (localesRequired && !selected.length) ||
                (action === 'publish' &&
                  selected.some(
                    (id) =>
                      !publicationSelection(
                        publicationReviews[id] ?? null,
                        referenceChoices[id] ?? [],
                      ).complete,
                  ))
              }
              onClick={() => void execute()}
            >
              {busy ? 'Applying…' : request.current ? 'Retry same selections' : `Confirm ${action}`}
            </Button>
          </div>
        </>
      )}
      <Modal
        open={!!checkpoint}
        onClose={() => setCheckpoint(null)}
        title={`Saved revision ${checkpoint?.revision ?? ''}`}
      >
        <pre className="read-only-json">{JSON.stringify(checkpoint?.content, null, 2)}</pre>
      </Modal>
    </Modal>
  );
}
