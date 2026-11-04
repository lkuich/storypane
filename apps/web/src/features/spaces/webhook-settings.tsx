'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Plus, RefreshCw, Webhook } from 'lucide-react';
import {
  webhookEventTypes,
  type WebhookDelivery,
  type WebhookEndpoint,
  type WebhookEventType,
} from '@storypane/core';
import { Button, EmptyState, ErrorNotice, Loading, Modal } from '@storypane/ui';
import { api, dateLabel, errorMessage, jsonRequest } from '../editor/api';

const initialEvents: WebhookEventType[] = [
  'story.published',
  'story.unpublished',
  'story.deleted',
  'asset.updated',
  'schema.deployed',
];
type DeliveryPage = { deliveries: WebhookDelivery[]; nextOffset: number | null };
export function WebhookSettings({
  onDirty,
  onBusy,
}: {
  onDirty: (dirty: boolean) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [endpoints, setEndpoints] = useState<WebhookEndpoint[]>([]);
  const [configured, setConfigured] = useState(false),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<WebhookEndpoint | null | undefined>(undefined);
  const [name, setName] = useState(''),
    [url, setUrl] = useState(''),
    [enabled, setEnabled] = useState(true),
    [events, setEvents] = useState<WebhookEventType[]>(initialEvents);
  const [secret, setSecret] = useState<string | null>(null);
  const [logsFor, setLogsFor] = useState<WebhookEndpoint | null>(null),
    [page, setPage] = useState<DeliveryPage | null>(null),
    [offset, setOffset] = useState(0),
    [logsLoading, setLogsLoading] = useState(false);
  const load = useCallback(async () => {
    setError('');
    try {
      const result = await api<{ configured: boolean; endpoints: WebhookEndpoint[] }>('/webhooks');
      setEndpoints(result.endpoints);
      setConfigured(result.configured);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    onDirty(editing !== undefined || secret !== null);
    return () => onDirty(false);
  }, [editing, secret, onDirty]);
  useEffect(() => {
    onBusy(busy);
    return () => onBusy(false);
  }, [busy, onBusy]);
  function open(endpoint: WebhookEndpoint | null) {
    setEditing(endpoint);
    setName(endpoint?.name ?? '');
    setUrl(endpoint?.url ?? '');
    setEnabled(endpoint?.enabled ?? true);
    setEvents(endpoint?.events ?? initialEvents);
    setError('');
  }
  async function logs(endpoint: WebhookEndpoint, start = 0) {
    setLogsFor(endpoint);
    setLogsLoading(true);
    setError('');
    try {
      setPage(await api<DeliveryPage>('/webhooks/' + endpoint.id + '/deliveries?offset=' + start));
      setOffset(start);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLogsLoading(false);
    }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await api<{ endpoint: WebhookEndpoint; secret?: string }>(
        '/webhooks' + (editing ? '/' + editing.id : ''),
        jsonRequest(editing ? 'PUT' : 'POST', {
          name,
          url,
          enabled,
          events,
          ...(editing ? { expectedRevision: editing.revision } : {}),
        }),
      );
      setEditing(undefined);
      if (result.secret) setSecret(result.secret);
      await load();
      setNotice('Webhook saved.');
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  async function action(endpoint: WebhookEndpoint, operation: 'test' | 'rotate-secret' | 'delete') {
    if (
      operation === 'delete' &&
      !window.confirm('Delete ' + endpoint.name + ' and cancel its queued deliveries?')
    )
      return;
    if (
      operation === 'rotate-secret' &&
      !window.confirm(
        'Rotate this secret and cancel queued deliveries? Update the receiving service before sending new events.',
      )
    )
      return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await api<{ secret?: string }>(
        '/webhooks/' + endpoint.id + (operation === 'delete' ? '' : '/' + operation),
        jsonRequest(operation === 'delete' ? 'DELETE' : 'POST', {
          expectedRevision: endpoint.revision,
        }),
      );
      if (result.secret) setSecret(result.secret);
      if (operation === 'test') {
        setNotice(
          'Test queued. Delivery normally starts within a minute; refresh logs to check the result.',
        );
        await logs(endpoint);
      } else {
        await load();
        setNotice(operation === 'delete' ? 'Webhook deleted.' : 'Signing secret rotated.');
      }
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  async function retry(delivery: WebhookDelivery) {
    if (!logsFor) return;
    setBusy(true);
    setError('');
    try {
      await api(
        '/webhooks/' + logsFor.id + '/deliveries/' + delivery.id + '/retry',
        jsonRequest('POST', {}),
      );
      setNotice('Delivery queued with the current webhook settings.');
      await logs(logsFor, offset);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <header className="panel-heading">
        <h2>
          <Webhook aria-hidden="true" />
          Webhooks
        </h2>
        <Button disabled={!configured || busy || loading} onClick={() => open(null)}>
          <Plus aria-hidden="true" />
          New webhook
        </Button>
      </header>
      <div className="panel-body">
        <p>Notify your site after publishing so it can rebuild or clear cached content.</p>
        <ErrorNotice message={error} retry={load} />
        {notice && (
          <p role="status" className="notice">
            {notice}
          </p>
        )}
        {!loading && !configured && (
          <p className="notice">
            Webhooks need an encryption key and approved destination hosts configured by the
            operator.
          </p>
        )}
        {loading ? (
          <Loading />
        ) : endpoints.length ? (
          <div className="roles-list">
            {endpoints.map((endpoint) => (
              <article className="role-card" key={endpoint.id}>
                <div>
                  <strong>{endpoint.name}</strong>
                  <span className="pill">{endpoint.enabled ? 'Enabled' : 'Disabled'}</span>
                  <p className="mono">{endpoint.url}</p>
                  <p>{endpoint.events.join(' · ')}</p>
                </div>
                <div className="button-group">
                  <Button disabled={busy || !configured} onClick={() => open(endpoint)}>
                    Edit
                  </Button>
                  <Button
                    disabled={busy || !configured || !endpoint.enabled}
                    onClick={() => void action(endpoint, 'test')}
                  >
                    Send test
                  </Button>
                  <Button disabled={busy} onClick={() => void logs(endpoint)}>
                    Delivery logs
                  </Button>
                  <Button
                    disabled={busy || !configured}
                    onClick={() => void action(endpoint, 'rotate-secret')}
                  >
                    Rotate secret
                  </Button>
                  <Button
                    variant="danger"
                    disabled={busy}
                    onClick={() => void action(endpoint, 'delete')}
                  >
                    Delete
                  </Button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState title="No webhooks yet" />
        )}
      </div>
      <Modal
        open={editing !== undefined}
        title={editing ? 'Edit webhook' : 'Create webhook'}
        onClose={() => {
          if (!busy) setEditing(undefined);
        }}
      >
        <form onSubmit={save}>
          <label className="field">
            Name
            <input
              required
              maxLength={120}
              value={name}
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="field">
            Endpoint URL
            <input
              required
              type="url"
              maxLength={2000}
              placeholder="https://example.com/api/rebuild"
              value={url}
              disabled={busy}
              onChange={(event) => setUrl(event.target.value)}
            />
            <span className="field-hint">Use an operator-approved public HTTPS destination.</span>
          </label>
          <fieldset className="role-permissions" disabled={busy}>
            <legend>Events</legend>
            {webhookEventTypes.map((type) => (
              <label key={type}>
                <input
                  type="checkbox"
                  checked={events.includes(type)}
                  onChange={(event) =>
                    setEvents((current) =>
                      event.target.checked
                        ? [...current, type]
                        : current.filter((item) => item !== type),
                    )
                  }
                />
                {type}
              </label>
            ))}
          </fieldset>
          <label>
            <input
              type="checkbox"
              checked={enabled}
              disabled={busy}
              onChange={(event) => setEnabled(event.target.checked)}
            />{' '}
            Enabled
          </label>
          <p className="field-hint">
            Draft events are optional. Changing settings cancels queued deliveries; failed
            deliveries can be retried with the current configuration.
          </p>
          <ErrorNotice message={error} />
          <div className="dialog-actions">
            <Button disabled={busy} onClick={() => setEditing(undefined)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={busy || !events.length}>
              {busy ? 'Saving…' : 'Save webhook'}
            </Button>
          </div>
        </form>
      </Modal>
      <Modal
        open={secret !== null}
        title="Save your webhook secret"
        onClose={() => setSecret(null)}
      >
        <p>
          This secret is shown once. Save it in the receiving service to verify webhook signatures.
        </p>
        <label className="field">
          Signing secret
          <input readOnly value={secret ?? ''} onFocus={(event) => event.target.select()} />
        </label>
        <div className="dialog-actions">
          <Button
            onClick={() => {
              void navigator.clipboard
                .writeText(secret ?? '')
                .catch(() => setError('Select and copy the secret above.'));
            }}
          >
            Copy secret
          </Button>
          <Button variant="primary" onClick={() => setSecret(null)}>
            Done
          </Button>
        </div>
      </Modal>
      <Modal
        open={logsFor !== null}
        title={'Deliveries · ' + (logsFor?.name ?? '')}
        onClose={() => {
          setLogsFor(null);
          setPage(null);
        }}
        wide
      >
        <ErrorNotice message={error} />
        <p>Events may arrive more than once or out of order. Logs are retained for 30 days.</p>
        <Button
          disabled={logsLoading || busy}
          onClick={() => {
            if (logsFor) void logs(logsFor, offset);
          }}
        >
          <RefreshCw aria-hidden="true" />
          Refresh deliveries
        </Button>
        {logsLoading ? (
          <Loading />
        ) : page?.deliveries.length ? (
          <div className="history-list">
            {page.deliveries.map((delivery) => (
              <article className="history-item" key={delivery.id}>
                <div>
                  <strong>{delivery.type}</strong>
                  <span className="pill">{delivery.status}</span>
                  <p>
                    {dateLabel(delivery.createdAt)} · {delivery.attemptCount} attempts
                    {delivery.httpStatus ? ' · HTTP ' + delivery.httpStatus : ''}
                  </p>
                  <p>{delivery.error}</p>
                  <small className="mono">Event {delivery.eventId}</small>
                  <details>
                    <summary>Attempts</summary>
                    {delivery.attempts.map((attempt) => (
                      <p key={attempt.number}>
                        #{attempt.number} · {dateLabel(attempt.startedAt)} ·{' '}
                        {attempt.httpStatus
                          ? 'HTTP ' + attempt.httpStatus
                          : attempt.completedAt
                            ? 'No HTTP response'
                            : 'In progress'}
                        {attempt.error ? ' · ' + attempt.error : ''}
                      </p>
                    ))}
                  </details>
                </div>
                {['failed', 'cancelled'].includes(delivery.status) && (
                  <Button
                    disabled={busy || !configured || !logsFor?.enabled}
                    onClick={() => void retry(delivery)}
                  >
                    Retry delivery
                  </Button>
                )}
              </article>
            ))}
          </div>
        ) : (
          <EmptyState title="No deliveries yet" />
        )}
        <div className="dialog-actions">
          <Button
            disabled={!offset || logsLoading}
            onClick={() => {
              if (logsFor) void logs(logsFor, Math.max(0, offset - 50));
            }}
          >
            Previous
          </Button>
          <Button
            disabled={page?.nextOffset == null || logsLoading}
            onClick={() => {
              if (logsFor && page?.nextOffset != null) void logs(logsFor, page.nextOffset);
            }}
          >
            Next
          </Button>
        </div>
      </Modal>
    </section>
  );
}
