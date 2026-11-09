# Known defects

## Multiple application instances do not share room notifications

**Status:** Fixed in application code with PostgreSQL room notifications. Local
multi-process checks passed; hosted scaling and capacity acceptance remain open.

**Tracking:** [GitHub issue #4](https://github.com/lkuich/storypane/issues/4).

WebSocket recipients remain local to each process. Combined/editor processes now
exchange room identifiers through the installation database using `LISTEN`/`NOTIFY`.
Each receiver rereads authoritative state and rechecks every recipient's access,
content scopes, preview session, and lease-token filtering. Content and credentials
never travel on the notification channel. Delivery processes do not subscribe.

Each editor holds one dedicated listener connection. It subscribes before becoming
ready, reconnects after interruptions, and refreshes active rooms after reconnecting.
`/api/ready` returns 503 while the listener is disconnected. Notifications are hints:
space writes and installation notifications are separate transactions, so existing
heartbeat synchronization also recovers a committed write whose signal was missed.

See the [local multi-process results](deployment-verification.md#shared-editor-rooms-local-checks--2026-11-09)
and [deployment requirements](deploy-railway.md#scale-editors).

Before increasing production replicas, verify load balancer WebSocket reconnect and
connection draining, unsent edits, multipart uploads across instances, background
work recovery during a process failure, and representative database/load capacity.
The template retains its one-replica default. Database and storage high availability
remain separate operational requirements.
