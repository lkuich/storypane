# Known defects

These are confirmed limitations of the current release. Proposed fixes below are
not available until their implementation and acceptance checks pass.

## Multiple application instances do not share room notifications

**Status:** Open. Run one combined/editor replica. Delivery-only replicas do not
host rooms and can scale separately.

**Tracking:** [GitHub issue #4](https://github.com/lkuich/storypane/issues/4).

### Impact and cause

Collaboration rooms and their WebSocket recipients live in a process-local map in
[`packages/runtime-node/src/index.ts`](../packages/runtime-node/src/index.ts).
HTTP edits, lease changes, and scheduled publications notify only recipients in
that same Node process. An editor or authenticated preview connected to another
instance misses the immediate update. Existing heartbeat synchronization can
recover current state, but it does not provide immediate cross-instance updates.

PostgreSQL remains authoritative for content, editing leases, sessions, and queued
work. This defect concerns notification delivery; it is not evidence of lost
committed content. Sticky sessions alone do not solve it because collaborators
and HTTP requests can reach different instances.

### Current workaround

Keep one combined/editor replica running, as described in the
[deployment architecture](architecture.md#deployment-and-scaling). Do not enable
horizontal scaling of editors until cross-instance notifications and recovery are
verified. An optional [delivery-only service](deploy-railway.md#scale-published-delivery-separately)
can scale published reads independently; it does not fix cross-instance rooms.

### Proposed fix

1. Add shared room notifications while keeping WebSocket connections local to
   each instance. Start by evaluating PostgreSQL `LISTEN`/`NOTIFY` through the
   installation database, using the existing `pg` dependency. Carry room
   identifiers and event types only; each receiving instance must reread state,
   reauthorize every recipient, and preserve content scopes and lease-token
   filtering. Do not distribute content snapshots or credentials on the bus.
2. Maintain a dedicated listener connection per instance. Reconnect and refresh
   active rooms after a listener interruption. Preserve heartbeat synchronization
   for missed notifications. Space writes and installation-database notifications
   are separate transactions, so a crash between them must remain recoverable.
3. Verify simultaneous background schedulers before changing their coordination.
   Scheduled releases already use row locks and webhooks use expiring claims;
   preserve publication atomicity and at-least-once webhook delivery.
4. Configure a WebSocket-capable load balancer, shared databases and private object
   storage, consistent authentication configuration and encryption keys, graceful
   connection draining, and database connection limits across replicas. Space
   acquisition currently creates short-lived pools, so measure aggregate
   connection pressure before increasing replica counts.

PostgreSQL notifications reach listeners in the same database, and listener
registrations end with their sessions. Treat notifications as refresh signals,
with database reads providing authoritative state. See the PostgreSQL
[`NOTIFY`](https://www.postgresql.org/docs/current/sql-notify.html) and
[`LISTEN`](https://www.postgresql.org/docs/current/sql-listen.html) documentation.

### Acceptance criteria

- Run two application instances against the same installation and space databases
  and private bucket. Force editors and previews onto different instances and
  route HTTP writes independently of their WebSocket connections.
- Verify immediate edits, lease changes, presence, preview updates, and scheduled
  publication notifications across instances. Recheck recipient scopes, revoked
  access, and absence of foreign lease tokens in HTTP and WebSocket snapshots.
- Interrupt the notification listener, commit changes during the interruption,
  and verify recovery after reconnection. Exercise the gap between a committed
  write and its notification, and tolerate duplicate refresh signals.
- Run both schedulers concurrently and kill an instance during work. Verify
  atomic approved releases, preservation of later drafts, webhook claim recovery,
  and the existing at-least-once delivery contract.
- Resume a multipart upload through another instance. Restart and drain instances
  behind the load balancer; verify clients reconnect and retain unsent edits.
- Measure database connections and representative editor load with both instances.
  Record results before removing the single-replica guidance.

The first milestone is two interchangeable Node instances with shared
notifications and passing recovery checks. Database and storage high availability
remain separate operational requirements.
