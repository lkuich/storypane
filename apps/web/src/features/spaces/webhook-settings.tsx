'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Plus, RefreshCw, Webhook } from 'lucide-react';
import {
  vercelDeployEvents,
  webhookEventTypes,
  type WebhookDelivery,
  type WebhookDestination,
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
const vercelEventLabels: Partial<Record<WebhookDelivery['type'], string>> = {
  'vercel.publish': 'Story published',
  'vercel.release': 'Release published',
  'vercel.rebuild': 'Manual rebuild',
};
function eventLabel(type: WebhookDelivery['type']) {
  return vercelEventLabels[type] ?? type;
}
function VercelMark() {
  return <span aria-hidden="true">▲</span>;
}
export function WebhookSettings({
  onDirty,
  onBusy,
}: {
  onDirty: (dirty: boolean) => void;
  onBusy: (busy: boolean) => void;
}) {
  const [endpoints, setEndpoints] = useState<WebhookDestination[]>([]);
  const [configured, setConfigured] = useState(false),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<WebhookDestination | null | undefined>(undefined);
  const [vercel, setVercel] = useState(false);
  const [name, setName] = useState(''),
    [url, setUrl] = useState(''),
    [enabled, setEnabled] = useState(true),
    [events, setEvents] = useState<WebhookDestination['events'][number][]>(initialEvents);
  const [secret, setSecret] = useState<string | null>(null);
  const [logsFor, setLogsFor] = useState<WebhookDestination | null>(null),
    [page, setPage] = useState<DeliveryPage | null>(null),
    [offset, setOffset] = useState(0),
    [logsLoading, setLogsLoading] = useState(false);
  const load = useCallback(async () => {
    setError('');
    try {
      const result = await api<{ configured: boolean; endpoints: WebhookDestination[] }>(
        '/webhooks',
      );
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
  function open(endpoint: WebhookDestination | null, isVercel = endpoint?.kind === 'vercel') {
    setEditing(endpoint);
    setVercel(isVercel);
    setName(endpoint?.name ?? '');
    setUrl(endpoint?.kind === 'vercel' ? '' : (endpoint?.url ?? ''));
    setEnabled(endpoint?.enabled ?? true);
    setEvents(endpoint?.events ?? (isVercel ? [...vercelDeployEvents] : initialEvents));
    setError('');
  }
  function closeEditor() {
    setUrl('');
    setEditing(undefined);
  }
  async function logs(endpoint: WebhookDestination, start = 0) {
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
      const result = await api<{ endpoint: WebhookDestination; secret?: string }>(
        '/webhooks' + (editing ? '/' + editing.id : ''),
        jsonRequest(editing ? 'PUT' : 'POST', {
          name,
          ...(vercel ? { kind: 'vercel', ...(url.trim() ? { url } : {}) } : { url }),
          enabled,
          events,
          ...(editing ? { expectedRevision: editing.revision } : {}),
        }),
      );
      closeEditor();
      if (result.secret) setSecret(result.secret);
      await load();
      setNotice(vercel ? 'Vercel connection saved.' : 'Webhook saved.');
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  async function action(
    endpoint: WebhookDestination,
    operation: 'test' | 'rebuild' | 'rotate-secret' | 'delete',
  ) {
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
      if (operation === 'test' || operation === 'rebuild') {
        setNotice(
          operation === 'rebuild'
            ? 'Rebuild queued. Check delivery logs to see when Vercel accepts it.'
            : 'Test queued. Delivery normally starts within a minute; refresh logs to check the result.',
        );
        await logs(endpoint);
      } else {
        await load();
        setNotice(
          operation === 'delete'
            ? endpoint.kind === 'vercel'
              ? 'Vercel connection removed.'
              : 'Webhook deleted.'
            : 'Signing secret rotated.',
        );
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
    <section className="panel webhook-settings">
      <header className="panel-heading">
        <h2>
          <Webhook aria-hidden="true" />
          Webhooks
        </h2>
        <div className="button-group">
          <Button
            className="button--small button--vercel"
            disabled={!configured || busy || loading}
            onClick={() => open(null, true)}
          >
            <VercelMark />
            Connect Vercel
          </Button>
          <Button
            className="button--small"
            disabled={!configured || busy || loading}
            onClick={() => open(null)}
          >
            <Plus aria-hidden="true" />
            New webhook
          </Button>
        </div>
      </header>
      <div className="panel-body">
        <p>Trigger a Vercel rebuild or notify another service when content changes.</p>
        <ErrorNotice message={error} retry={load} />
        {notice && (
          <p role="status" className="notice">
            {notice}
          </p>
        )}
        {!loading && !configured && (
          <p className="notice">Webhooks need an encryption key configured by the operator.</p>
        )}
        {loading ? (
          <Loading />
        ) : endpoints.length ? (
          <div className="webhook-list">
            {endpoints.map((endpoint) => (
              <article className="webhook-card" key={endpoint.id}>
                <div className="webhook-card-details">
                  <div className="webhook-card-heading">
                    <h3>{endpoint.name}</h3>
                    {endpoint.kind === 'vercel' && (
                      <span className="pill pill--outline">
                        <VercelMark /> Vercel
                      </span>
                    )}
                    <span className="pill">{endpoint.enabled ? 'Enabled' : 'Disabled'}</span>
                  </div>
                  {endpoint.kind !== 'vercel' && <p className="mono">{endpoint.url}</p>}
                  <div className="webhook-events">
                    {endpoint.events.map((event) => (
                      <span className="pill pill--outline" key={event}>
                        {eventLabel(event)}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="button-group">
                  <Button disabled={busy || !configured} onClick={() => open(endpoint)}>
                    {endpoint.kind === 'vercel' && <VercelMark />}
                    Edit
                  </Button>
                  <Button
                    className={endpoint.kind === 'vercel' ? 'button--vercel' : undefined}
                    disabled={busy || !configured || !endpoint.enabled}
                    onClick={() =>
                      void action(endpoint, endpoint.kind === 'vercel' ? 'rebuild' : 'test')
                    }
                  >
                    {endpoint.kind === 'vercel' && <VercelMark />}
                    {endpoint.kind === 'vercel' ? 'Rebuild now' : 'Send test'}
                  </Button>
                  <Button disabled={busy} onClick={() => void logs(endpoint)}>
                    {endpoint.kind === 'vercel' && <VercelMark />}
                    Delivery logs
                  </Button>
                  {endpoint.kind !== 'vercel' && (
                    <Button
                      disabled={busy || !configured}
                      onClick={() => void action(endpoint, 'rotate-secret')}
                    >
                      Rotate secret
                    </Button>
                  )}
                  <Button
                    variant="danger"
                    disabled={busy}
                    onClick={() => void action(endpoint, 'delete')}
                  >
                    {endpoint.kind === 'vercel' && <VercelMark />}
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
        title={
          vercel
            ? editing
              ? 'Edit Vercel connection'
              : 'Connect Vercel'
            : editing
              ? 'Edit webhook'
              : 'Create webhook'
        }
        onClose={() => {
          if (!busy) closeEditor();
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
            {vercel ? 'Vercel Deploy Hook URL' : 'Endpoint URL'}
            <input
              required={!vercel || !editing}
              type={vercel ? 'password' : 'url'}
              autoComplete={vercel ? 'off' : undefined}
              maxLength={2000}
              placeholder={vercel ? undefined : 'https://example.com/api/rebuild'}
              value={url}
              disabled={busy}
              onChange={(event) => setUrl(event.target.value)}
            />
            <span className="field-hint">
              {vercel
                ? editing
                  ? 'Leave blank to keep the saved Deploy Hook URL.'
                  : 'Create a Deploy Hook for the branch you want to rebuild in your Vercel project’s Git settings.'
                : 'Use an operator-approved public HTTPS destination.'}
            </span>
          </label>
          <fieldset className="role-permissions" disabled={busy}>
            <legend>{vercel ? 'Rebuild automatically on' : 'Events'}</legend>
            {(vercel ? vercelDeployEvents : webhookEventTypes).map((type) => (
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
                {eventLabel(type)}
              </label>
            ))}
          </fieldset>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={enabled}
              disabled={busy}
              onChange={(event) => setEnabled(event.target.checked)}
            />{' '}
            Enabled
          </label>
          <p className="field-hint">
            {vercel
              ? 'Leave both events unchecked for manual rebuilds only. Changing settings cancels queued rebuilds.'
              : 'Draft events are optional. Changing settings cancels queued deliveries. You can retry failed deliveries with the current configuration.'}
          </p>
          <ErrorNotice message={error} />
          <div className="dialog-actions">
            <Button disabled={busy} onClick={closeEditor}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              className={vercel ? 'button--vercel' : undefined}
              disabled={busy || (!vercel && !events.length)}
            >
              {vercel && <VercelMark />}
              {busy ? 'Saving…' : vercel ? 'Save connection' : 'Save webhook'}
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
        <p>
          {logsFor?.kind === 'vercel'
            ? 'A successful delivery means Vercel accepted the rebuild request. Check Vercel for build progress.'
            : 'Events may arrive more than once or out of order. Logs are retained for 30 days.'}
        </p>
        <Button
          className="icon-button"
          aria-label="Refresh deliveries"
          title="Refresh deliveries"
          disabled={logsLoading || busy}
          onClick={() => {
            if (logsFor) void logs(logsFor, offset);
          }}
        >
          <RefreshCw aria-hidden="true" />
        </Button>
        {logsLoading ? (
          <Loading />
        ) : page?.deliveries.length ? (
          <div className="history-list webhook-deliveries">
            {page.deliveries.map((delivery) => (
              <article className="history-item" key={delivery.id}>
                <div>
                  <div className="webhook-delivery-heading">
                    <strong>{eventLabel(delivery.type)}</strong>
                    <span className="pill">{delivery.status}</span>
                  </div>
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
                    className={logsFor?.kind === 'vercel' ? 'button--vercel' : undefined}
                    disabled={busy || !configured || !logsFor?.enabled}
                    onClick={() => void retry(delivery)}
                  >
                    {logsFor?.kind === 'vercel' && <VercelMark />}
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
