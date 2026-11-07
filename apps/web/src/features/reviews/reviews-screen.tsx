'use client';
import { useState } from 'react';
import { ArrowUpRight, CheckCheck, Inbox, RefreshCw } from 'lucide-react';
import type { Discussion, ReviewDirectory } from '@storypane/core';
import { Button, ErrorNotice, Loading, Modal } from '@storypane/ui';
import { api, dateLabel, errorMessage } from '../editor/api';
import { DiscussionDetails, reviewStatus } from './discussion-details';
import './reviews.css';

export function ReviewsScreen({
  discussions,
  userId,
  canReview,
  error,
  onRefresh,
}: {
  discussions: Discussion[] | null;
  userId: string;
  canReview: boolean;
  error: string;
  onRefresh: () => Promise<void>;
}) {
  const [view, setView] = useState<'available' | 'requested' | 'history'>(
    canReview ? 'available' : 'requested',
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [directory, setDirectory] = useState<ReviewDirectory | null>(null);
  const [detailError, setDetailError] = useState('');
  const reviews = (discussions ?? []).filter((item) => item.kind === 'review');
  const requested = reviews.filter(
    (item) =>
      item.requesterId === userId &&
      ['pending', 'changes_requested', 'approved'].includes(item.status),
  );
  const available = reviews.filter((item) => item.canDecide);
  const history = (discussions ?? []).filter(
    (item) =>
      item.requesterId === userId ||
      item.reviewers.some((member) => member.id === userId) ||
      item.messages.some(
        (message) => message.mentionIds.includes(userId) || message.userId === userId,
      ),
  );
  const visible = view === 'available' ? available : view === 'requested' ? requested : history;
  const thread = discussions?.find((item) => item.id === selected);
  async function select(item: Discussion) {
    setSelected(item.id);
    setDirectory(null);
    setDetailError('');
    try {
      setDirectory(
        await api<ReviewDirectory>(
          `/reviews/directory?${new URLSearchParams({ storyId: item.storyId, localeId: item.localeId, ...(item.blockId ? { blockId: item.blockId } : {}) })}`,
        ),
      );
    } catch (cause) {
      setDetailError(errorMessage(cause));
    }
  }
  return (
    <div className="reviews-screen">
      <div className="page-heading">
        <div>
          <div className="eyebrow">A second pair of eyes</div>
          <h1>Reviews</h1>
          <p>
            Move good work forward. See what needs your approval and follow the stories you’ve sent
            for review.
          </p>
        </div>
        <Button
          className="icon-button"
          aria-label="Refresh reviews"
          title="Refresh reviews"
          onClick={() => void onRefresh().catch((cause) => setDetailError(errorMessage(cause)))}
        >
          <RefreshCw aria-hidden="true" />
        </Button>
      </div>
      <ErrorNotice message={error || detailError} retry={onRefresh} />
      <div className="review-views" aria-label="Review views">
        {canReview && (
          <Button
            variant={view === 'available' ? 'primary' : 'ghost'}
            aria-pressed={view === 'available'}
            onClick={() => setView('available')}
          >
            Available to review <span className="pill">{available.length}</span>
          </Button>
        )}
        <Button
          variant={view === 'requested' ? 'primary' : 'ghost'}
          aria-pressed={view === 'requested'}
          onClick={() => setView('requested')}
        >
          Requested by me <span className="pill">{requested.length}</span>
        </Button>
        <Button
          variant={view === 'history' ? 'primary' : 'ghost'}
          aria-pressed={view === 'history'}
          onClick={() => setView('history')}
        >
          History & mentions
        </Button>
      </div>
      {discussions === null ? (
        <Loading label="Loading reviews…" />
      ) : !visible.length ? (
        <section className="panel review-empty">
          <Inbox aria-hidden="true" />
          <h2>
            {view === 'available'
              ? 'You’re all caught up.'
              : view === 'requested'
                ? 'Give your next story a second look.'
                : 'Every decision has a story.'}
          </h2>
          <p>
            {view === 'available'
              ? 'Reviews assigned to you or your teams will appear here when they need your decision.'
              : view === 'requested'
                ? 'Request review from a story or block. You’ll be able to follow its approvals here.'
                : 'Your review decisions, discussions, and mentions will appear here.'}
          </p>
        </section>
      ) : (
        <section className="panel review-inbox" aria-label="Review requests">
          <div className="review-inbox-heading">
            <span>Story / scope</span>
            <span>Approval progress</span>
            <span>Status</span>
          </div>
          {visible.map((item) => (
            <button key={item.id} className="review-inbox-row" onClick={() => void select(item)}>
              <span className="review-inbox-story">
                <span className="review-inbox-icon">
                  <CheckCheck aria-hidden="true" />
                </span>
                <span>
                  <strong>{item.storyName}</strong>
                  <small>
                    {item.localeName} · {item.blockName ?? 'Whole story'}
                  </small>
                  <small>
                    {item.requesterName} · {dateLabel(item.createdAt)}
                  </small>
                </span>
              </span>
              <span className="review-inbox-progress">
                {item.teams.map((team) => (
                  <span key={team.id}>
                    {team.name}
                    <strong>
                      {team.approvals}/{team.minimumApprovals}
                    </strong>
                  </span>
                ))}
                {!!item.reviewerIds.length && (
                  <span>
                    People
                    <strong>
                      {
                        item.reviewers.filter(
                          (member) =>
                            item.reviewerIds.includes(member.id) && member.decision === 'approve',
                        ).length
                      }
                      /{item.reviewerIds.length}
                    </strong>
                  </span>
                )}
                {item.kind === 'comment' && <span>Discussion</span>}
              </span>
              <span className="review-inbox-status">
                <span className={`review-status review-status--${item.status}`}>
                  {reviewStatus[item.status]}
                </span>
                <ArrowUpRight aria-hidden="true" />
              </span>
            </button>
          ))}
        </section>
      )}
      <Modal
        open={!!thread}
        title="Review details"
        wide
        className="review-dialog"
        onClose={() => setSelected(null)}
      >
        {thread &&
          (directory ? (
            <DiscussionDetails
              key={thread.id}
              discussion={thread}
              members={directory.members}
              onChange={onRefresh}
            />
          ) : detailError ? (
            <ErrorNotice message={detailError} retry={() => void select(thread)} />
          ) : (
            <Loading label="Loading review…" />
          ))}
      </Modal>
    </div>
  );
}
