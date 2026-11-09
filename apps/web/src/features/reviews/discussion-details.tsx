'use client';
import { useState } from 'react';
import { Check, MessageSquare, RotateCcw, Trash2, Users } from 'lucide-react';
import type { Discussion, DiscussionAction, ReviewPerson } from '@storypane/core';
import { Button, ErrorNotice } from '@storypane/ui';
import { api, dateLabel, errorMessage, jsonRequest } from '../editor/api';
import { MentionInput } from './mention-input';
import { deleteDiscussion } from './delete-discussion';
import type { Mention } from './mentions';
import { storyUrl, selectedSpaceId } from '../../lib/space-url';

export const reviewStatus = {
  pending: 'Awaiting approval',
  changes_requested: 'Changes requested',
  approved: 'Approved',
  withdrawn: 'Withdrawn',
  published: 'Published',
  open: 'Discussion',
  resolved: 'Resolved',
};
const eventLabel: Record<string, string> = {
  requested: 'Requested review',
  approve: 'Approved',
  request_changes: 'Requested changes',
  withdraw: 'Withdrew review',
  resolve: 'Resolved discussion',
  reopen: 'Reopened discussion',
  published: 'Published approved content',
};
export function DiscussionDetails({
  discussion,
  members = [],
  onChange,
}: {
  discussion: Discussion;
  members?: ReviewPerson[];
  onChange: () => Promise<void>;
}) {
  const [message, setMessage] = useState('');
  const [mentions, setMentions] = useState<Mention[]>([]);
  const mentionIds = [...new Set(mentions.map((mention) => mention.id))];
  const [changes, setChanges] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const active = ['pending', 'changes_requested', 'approved', 'open'].includes(discussion.status);
  async function act(input: DiscussionAction) {
    setBusy(true);
    setError('');
    try {
      await api(`/reviews/${discussion.id}`, jsonRequest('PUT', input));
      if ('message' in input) {
        setMessage('');
        setMentions([]);
      }
      setChanges(false);
      await onChange();
      window.dispatchEvent(new Event('reviews-changed'));
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    setError('');
    try {
      if (await deleteDiscussion(discussion)) await onChange();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="discussion-detail">
      <div className="review-context">
        <span className={`review-status review-status--${discussion.status}`}>
          {reviewStatus[discussion.status]}
        </span>
        <span>{discussion.localeName}</span>
        <span>{discussion.blockName ?? 'Whole story'}</span>
      </div>
      <h3 className="review-story-name">{discussion.storyName}</h3>
      <a
        className="button button--secondary"
        href={storyUrl({
          spaceId: selectedSpaceId()!,
          storyId: discussion.storyId,
          localeSlug: discussion.locale,
          blockId: discussion.blockId ?? undefined,
        })}
      >
        Open {discussion.blockId ? 'block' : 'story'} to review <span aria-hidden="true">↗</span>
      </a>
      {discussion.kind === 'review' && (
        <div className="review-requirements">
          <h4>Approval requirements</h4>
          {discussion.reviewerIds.map((id) => {
            const reviewer = discussion.reviewers.find((item) => item.id === id);
            return (
              <div className="review-requirement" key={id}>
                <Check
                  aria-hidden="true"
                  className={reviewer?.decision === 'approve' ? 'review-approved' : ''}
                />
                <strong>{reviewer?.name ?? 'Unavailable reviewer'}</strong>
                <span>
                  {reviewer?.decision === 'approve'
                    ? 'Approved'
                    : reviewer?.decision === 'request_changes'
                      ? 'Changes requested'
                      : 'Pending'}
                </span>
              </div>
            );
          })}
          {discussion.teams.map((team) => (
            <div className="review-requirement" key={team.id}>
              <Users aria-hidden="true" />
              <strong>{team.name}</strong>
              <span>
                {team.approvals} / {team.minimumApprovals} approved
              </span>
            </div>
          ))}
          {discussion.changed && active && (
            <p className="notice">
              Content has changed since this review was requested. Only approvals for the current
              version count.
            </p>
          )}
          {!!discussion.teams.length && (
            <details className="review-team-members">
              <summary>Reviewer decisions</summary>
              {discussion.reviewers.map((member) => (
                <p key={member.id}>
                  {member.name}
                  <span>
                    {member.decision === 'approve'
                      ? 'Approved'
                      : member.decision === 'request_changes'
                        ? 'Changes requested'
                        : 'Pending'}
                  </span>
                </p>
              ))}
            </details>
          )}
        </div>
      )}
      <div className="discussion-messages" aria-label="Discussion history">
        {discussion.messages.map((item) => (
          <article
            key={item.id}
            className={`discussion-message${item.event === 'approve' ? ' discussion-message--approved' : ''}`}
          >
            <span className="avatar" aria-hidden="true">
              {item.name.slice(0, 1)}
            </span>
            <div>
              <header>
                <strong>{item.name}</strong>
                <time dateTime={item.createdAt}>{dateLabel(item.createdAt)}</time>
              </header>
              {eventLabel[item.event] && (
                <small className="muted">
                  {eventLabel[item.event]}
                  {item.contentRevision != null ? ` · revision ${item.contentRevision}` : ''}
                </small>
              )}
              {item.body && <p>{item.body}</p>}
            </div>
          </article>
        ))}
      </div>
      <ErrorNotice message={error} />
      {active && (
        <form
          className="discussion-response"
          onSubmit={(event) => {
            event.preventDefault();
            void act(
              changes
                ? {
                    action: 'request_changes',
                    message,
                    mentionIds,
                    expectedVersion: discussion.version,
                  }
                : { action: 'reply', message, mentionIds },
            );
          }}
        >
          <fieldset disabled={busy} className="space-settings-fields">
            <MentionInput
              members={members}
              value={message}
              mentions={mentions}
              onChange={(value, nextMentions) => {
                setMessage(value);
                setMentions(nextMentions);
              }}
              required
              label={changes ? 'Changes needed' : 'Reply'}
            />
            <div className="review-response-actions">
              <Button type="submit" disabled={!message.trim()}>
                {changes ? 'Send requested changes' : 'Reply'}
              </Button>
              {changes && (
                <Button variant="ghost" onClick={() => setChanges(false)}>
                  Cancel
                </Button>
              )}
              {discussion.canDecide && !changes && (
                <>
                  <Button variant="ghost" onClick={() => setChanges(true)}>
                    Request changes
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() =>
                      void act({ action: 'approve', expectedVersion: discussion.version })
                    }
                  >
                    <Check aria-hidden="true" />
                    Approve
                  </Button>
                </>
              )}
            </div>
          </fieldset>
        </form>
      )}
      <div className="review-thread-actions">
        {discussion.canDelete && (
          <Button variant="danger" disabled={busy} onClick={() => void remove()}>
            <Trash2 aria-hidden="true" />
            Delete {discussion.kind === 'review' ? 'review' : 'discussion'}
          </Button>
        )}
        {discussion.canWithdraw && (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  'Withdraw this review request? Its approval requirement will no longer block publishing.',
                )
              )
                void act({ action: 'withdraw' });
            }}
          >
            Withdraw request
          </Button>
        )}
        {discussion.kind === 'comment' && (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void act({ action: discussion.status === 'resolved' ? 'reopen' : 'resolve' })
            }
          >
            {discussion.status === 'resolved' ? (
              <RotateCcw aria-hidden="true" />
            ) : (
              <MessageSquare aria-hidden="true" />
            )}
            {discussion.status === 'resolved' ? 'Reopen discussion' : 'Resolve discussion'}
          </Button>
        )}
      </div>
    </div>
  );
}
