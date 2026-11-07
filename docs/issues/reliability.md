# Reliability gaps

Status: open; recorded 2026-11-06 against the rc.3 documentation.

These are operational limits and outstanding verification, not claims that the
covered features are broken. The authoritative checklist and dated evidence are
in [deployment verification](../deployment-verification.md). Existing local tests
and scoped Railway checks do not establish full hosted acceptance.

## Complete hosted acceptance

Priority: before claiming production readiness.

The Railway record still leaves these workflows outstanding on that deployment:

- Two-editor collaboration, conflicting locks, disconnect/reconnect, and recovery
  of preserved unsent input.
- Authenticated preview and the HTTP/WebSocket content-scope matrix.
- Schema sync conflict resolution and separate development/production CLI
  credentials, including interrupted transfer retries.
- Scheduled releases and signed webhook delivery/retries.
- Account recovery, provider switching, and real provider session/account revocation
  where the existing record only establishes automated or local coverage.
- Interrupted multipart upload resume and database outage/recovery behavior.

Completion evidence: run the applicable full checklist on a disposable hosted
installation, recording revision, providers, results, and failures. Fix failures
and repeat affected checks. Do not test against real production content to close
this issue or relabel local evidence as hosted acceptance.

## Rehearse backup and restore

Priority: before relying on the installation for recoverable production content.

A complete hosted restore rehearsal remains outstanding. Restore the installation
database, every space database, original private media, and required encryption
and authentication keys into an isolated environment. Preserve migration history,
identities, permissions, publications, pending jobs, and encrypted settings.
Contain outbound email/webhook effects during recovery testing.

Completion evidence: verify sign-in, scopes, drafts and published content, original
media, encrypted connections, and pending-job behavior after recovery. Record
recovery time, the recovered data point, and any data loss. A successful backup
job alone does not close this issue. Follow the existing
[backup and recovery procedure](../self-hosting.md#backups-upgrades-and-health).

## Establish production load limits

Priority: before making capacity or performance claims.

Production load benchmarks remain outstanding. Measure concurrent editing,
delivery reads, uploads/image transforms, and background publication/webhook work
on a documented deployment and representative content set. Include database
connections, latency, errors, resource consumption, and reconnect behavior.

Completion evidence: record the workload, hardware/provider configuration,
observed limits, and safe operating envelope; address measured bottlenecks.
Choose any scaling work from those results rather than assuming it is required.

## Respect the single-replica constraint

Status: known architectural limit; scaling work is not yet committed.

The Node runtime keeps collaboration rooms in process and currently requires one
application replica. The Railway template disables sleeping. Multiple replicas
cannot be treated as a supported high-availability deployment merely because
PostgreSQL remains authoritative.

Near-term completion: verify restart/outage recovery and document the measured
operating limits above while retaining one replica. If availability or capacity
requirements demand multiple replicas, separately scope shared room transport,
cross-instance authorization/revocation, reconnect consistency, and background-job
coordination before enabling them. Preserve Postgres authority and lease secrecy.

References: [runtime guidance](../self-hosting.md),
[`packages/runtime-node/src/index.ts`](../../packages/runtime-node/src/index.ts).

## Independent security review

Priority: before claiming independently reviewed security.

An independent security audit remains outstanding. Scope authentication and session
revocation, space/database isolation, recipient-filtered HTTP/WebSocket snapshots,
lease secrecy, draft/private-media access, management credentials, webhook secret
handling, and migration/upgrade behavior.

Completion evidence: record the reviewed revision and scope, remediate findings,
and verify fixes with regression coverage. Passing automated tests and dependency
audits alone does not close this issue.
