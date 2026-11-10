Storypane **0.1.0-rc.10** — release candidate for evaluation.

- Run published SDK delivery in an optional separate service that can be replicated
  independently of the editor. Keep live preview and schema tooling on the editor.
- Share editor room signals through PostgreSQL `LISTEN`/`NOTIFY`. Each process
  reauthorizes its own recipients and recovers active rooms after listener outages.
- Move space deletion into General settings with the existing administrator and
  confirmation safeguards.
- Update architecture, scaling requirements, connection budgets, and verification
  records. The Railway template is unchanged.

Install the CMS from source tag `v0.1.0-rc.10`; Docker Compose builds that checkout.
The Railway template builds moving `main`, not a pinned candidate. Install the
SDK with `npm install @storypane/sdk@0.1.0-rc.10`, or follow `@storypane/sdk@rc`
after npm publication completes. The tarball is attached to this prerelease.
There is no new public SDK API or database migration beyond rc.9. Older
installations still apply pending migrations through the transactional production
migration runner.

Back up the installation database, every space database, original media,
configuration, and keys before upgrading. Keep the existing transactional
pre-deploy migration command. Never use local-only `db:setup` on a hosted
installation. Rollback after database changes requires a coordinated backup restore.

Local checks cover two editor processes, concurrent edits, leases, preview,
recipient filtering, listener recovery, scheduled publication, and process
replacement. The hosted rollout remains one editor replica; production capacity,
load-balancer reconnect/draining, and cross-instance upload checks remain pending.
Budget up to 38 PostgreSQL connections per editor replica and 37 per delivery
replica, plus operational headroom. Do not increase replicas without checking
aggregate database capacity. Full fresh-install acceptance, independent security
review, and production load benchmarks remain outstanding.

- [Railway deployment and updates](https://github.com/lkuich/storypane/blob/v0.1.0-rc.10/docs/deploy-railway.md)
- [Release and upgrade guide](https://storypane.dev/docs/releases-and-versioning/)
- [Verification record](https://github.com/lkuich/storypane/blob/v0.1.0-rc.10/docs/deployment-verification.md)
- [Changelog](https://github.com/lkuich/storypane/blob/v0.1.0-rc.10/CHANGELOG.md)
- [Report security issues privately](https://github.com/lkuich/storypane/security/advisories/new)

MIT licensed, provided without warranty under LICENSE. Hosting, identity, mail,
storage and agent providers have their own terms and costs.
