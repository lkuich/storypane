'use client';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { Discussion, ReviewDirectory } from '@storypane/core';
import { Button, ErrorNotice, Loading, Modal } from '@storypane/ui';
import { api, dateLabel, errorMessage, jsonRequest } from '../editor/api';
import { MentionInput } from './mention-input';
import type { Mention } from './mentions';
import { DiscussionDetails, reviewStatus } from './discussion-details';
import './reviews.css';

export function ReviewDialog({
  storyId,
  localeId,
  blockId,
  scopeName,
  onClose,
  beforeRequest,
  refreshKey,
  request = false,
}: {
  storyId: string;
  localeId: string;
  blockId: string | null;
  scopeName: string;
  onClose: () => void;
  beforeRequest: () => Promise<boolean>;
  refreshKey: number;
  request?: boolean;
}) {
  const [threads, setThreads] = useState<Discussion[] | null>(null);
  const [directory, setDirectory] = useState<ReviewDirectory | null>(null);
  const [mode, setMode] = useState<'review' | 'comment'>(request ? 'review' : 'comment');
  const [selected, setSelected] = useState<string | null>(null);
  const [reviewerIds, setReviewerIds] = useState<string[]>([]);
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const load = useCallback(async () => {
    const query = new URLSearchParams({ storyId, localeId });
    const [items, people] = await Promise.all([
      api<Discussion[]>(`/reviews?${query}`),
      api<ReviewDirectory>(`/reviews/directory?${query}${blockId ? `&blockId=${blockId}` : ''}`),
    ]);
    setThreads(blockId ? items.filter((item) => item.blockId === blockId) : items);
    setDirectory(people);
  }, [storyId, localeId, blockId]);
  useEffect(() => {
    let stopped = false;
    void load().catch((cause) => {
      if (!stopped) setError(errorMessage(cause));
    });
    return () => {
      stopped = true;
    };
  }, [load, refreshKey]);
  async function submit() {
    if (!directory) return;
    setBusy(true);
    setError('');
    try {
      if (!(await beforeRequest()))
        throw new Error('Resolve your unsaved changes before starting a review or discussion.');
      const query = new URLSearchParams({ storyId, localeId, ...(blockId ? { blockId } : {}) });
      const current = await api<ReviewDirectory>(`/reviews/directory?${query}`);
      const result = await api<{ id: string }>(
        '/reviews',
        jsonRequest('POST', {
          storyId,
          localeId,
          blockId,
          kind: mode,
          message,
          reviewerIds: mode === 'review' ? reviewerIds : [],
          teamIds: mode === 'review' ? teamIds : [],
          mentionIds: [...new Set(mentions.map((mention) => mention.id))],
          expectedVersion: current.version,
        }),
      );
      setMode('comment');
      setReviewerIds([]);
      setTeamIds([]);
      setSearch('');
      setSelected(result.id);
      setMessage('');
      setMentions([]);
      await load();
      window.dispatchEvent(new Event('reviews-changed'));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  const thread = threads?.find((item) => item.id === selected);
  return (
    <Modal
      open
      title="Reviews & comments"
      description={scopeName}
      wide
      className="review-dialog"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <ErrorNotice
        message={error}
        retry={() => void load().catch((cause) => setError(errorMessage(cause)))}
      />
      {threads === null || !directory ? (
        <Loading label="Loading reviews…" />
      ) : thread ? (
        <>
          <Button variant="ghost" className="button--small" onClick={() => setSelected(null)}>
            <ArrowLeft aria-hidden="true" />
            All discussions
          </Button>
          <DiscussionDetails
            key={thread.id}
            discussion={thread}
            members={directory.members}
            onChange={load}
          />
        </>
      ) : (
        <>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <fieldset disabled={busy} className="space-settings-fields">
              <MentionInput
                members={directory.members}
                value={message}
                mentions={mentions}
                onChange={(value, nextMentions) => {
                  setMessage(value);
                  setMentions(nextMentions);
                }}
                required={mode === 'comment'}
                label={mode === 'review' ? 'Message (optional)' : 'Comment'}
              />
              <label className="review-toggle">
                <span>
                  <strong>Request review</strong>
                  <small id="review-toggle-hint">
                    Require approval before publishing these changes.
                  </small>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  checked={mode === 'review'}
                  aria-label="Request review"
                  aria-describedby="review-toggle-hint"
                  onChange={(event) => setMode(event.target.checked ? 'review' : 'comment')}
                />
              </label>
              {mode === 'review' && (
                <>
                  <label className="field">
                    Find reviewers
                    <input
                      type="search"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Search people and teams"
                    />
                  </label>
                  <fieldset className="review-choices">
                    <legend>Teams</legend>
                    {!directory.teams.length && (
                      <p className="muted">Create teams in Settings → Members & roles.</p>
                    )}
                    {directory.teams
                      .filter((team) => team.name.toLowerCase().includes(search.toLowerCase()))
                      .map((team) => {
                        const eligible = team.memberIds.filter((id) =>
                          directory.members.some((member) => member.id === id && member.canReview),
                        ).length;
                        return (
                          <label className="review-choice" key={team.id}>
                            <input
                              type="checkbox"
                              checked={teamIds.includes(team.id)}
                              disabled={eligible < team.minimumApprovals}
                              onChange={(event) =>
                                setTeamIds(
                                  event.target.checked
                                    ? [...teamIds, team.id]
                                    : teamIds.filter((id) => id !== team.id),
                                )
                              }
                            />
                            <span>
                              <strong>{team.name}</strong>
                              <small>
                                {team.minimumApprovals}{' '}
                                {team.minimumApprovals === 1 ? 'approval' : 'approvals'} required ·{' '}
                                {eligible} eligible members
                                {eligible < team.minimumApprovals ? ' · Not enough reviewers' : ''}
                              </small>
                            </span>
                          </label>
                        );
                      })}
                  </fieldset>
                  <fieldset className="review-choices">
                    <legend>People</legend>
                    <div className="review-member-list">
                      {directory.members
                        .filter(
                          (member) =>
                            member.canReview &&
                            `${member.name} ${member.email}`
                              .toLowerCase()
                              .includes(search.toLowerCase()),
                        )
                        .map((member) => (
                          <label className="review-choice" key={member.id}>
                            <input
                              type="checkbox"
                              checked={reviewerIds.includes(member.id)}
                              onChange={(event) =>
                                setReviewerIds(
                                  event.target.checked
                                    ? [...reviewerIds, member.id]
                                    : reviewerIds.filter((id) => id !== member.id),
                                )
                              }
                            />
                            <span>
                              <strong>{member.name}</strong>
                              <small>{member.email}</small>
                            </span>
                          </label>
                        ))}
                    </div>
                    <p className="field-hint">
                      Every selected person must approve. You cannot approve your own request.
                    </p>
                  </fieldset>
                </>
              )}
              <div className="dialog-actions">
                <Button onClick={onClose}>Cancel</Button>
                <Button
                  variant="primary"
                  type="submit"
                  disabled={
                    mode === 'review' ? !reviewerIds.length && !teamIds.length : !message.trim()
                  }
                >
                  {busy ? 'Sending…' : mode === 'review' ? 'Request review' : 'Post comment'}
                </Button>
              </div>
            </fieldset>
          </form>
          {threads.length > 0 && (
            <section className="review-existing" aria-label="Existing discussions">
              <h3>
                Discussions <span className="pill">{threads.length}</span>
              </h3>
              <div className="review-thread-list">
                {threads.map((item) => (
                  <button
                    className="review-thread"
                    key={item.id}
                    onClick={() => setSelected(item.id)}
                  >
                    <span className={`review-status review-status--${item.status}`}>
                      {reviewStatus[item.status]}
                    </span>
                    <strong>
                      {item.messages.find((message) => message.body)?.body || 'Review request'}
                    </strong>
                    <small>
                      {item.blockName ?? 'Whole story'} · {item.requesterName} ·{' '}
                      {dateLabel(item.createdAt)} · {item.messages.length} updates
                    </small>
                  </button>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </Modal>
  );
}
