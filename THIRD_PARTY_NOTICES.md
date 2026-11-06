# Third-party notices

Storypane's own source is MIT licensed. Dependencies, media, fonts, and separately
run services retain their respective licenses. Keep their notices when
redistributing source, packages, or images; the root LICENSE does not relicense them.

## Editor assets

- Plus Jakarta Sans: [SIL Open Font License](apps/web/public/fonts/OFL.txt).
- Lucide icons: [Lucide license](apps/web/public/LUCIDE-LICENSE.txt).

## Services in the Docker Compose example

- PostgreSQL: [PostgreSQL license](https://www.postgresql.org/about/licence/).
- The pinned MinIO server/client image: **AGPL-3.0**, separate from Storypane's MIT
  code. The image is built by [coollabsio/minio](https://github.com/coollabsio/minio)
  from [MinIO source](https://github.com/minio/minio). Retain its license and source
  information and review the AGPL requirements for your use or redistribution.
  You can configure a different compatible S3 service instead; the operator's
  provider terms apply. This notice is not a legal interpretation of the AGPL.
- The Node/Debian image and its OS libraries retain their upstream notices.

## JavaScript and native dependencies

The lockfile records exact dependency versions. Dependencies include React,
vinext, Better Auth, Clerk's client/backend libraries, the AWS SDK, Sharp/libvips,
the MCP SDK, and their transitive dependencies. Inspect installed package LICENSE
files for the applicable terms. Optional hosted Clerk, mail, storage, and model
services have their own service terms in addition to SDK licenses.

After a frozen-lockfile install, generate a version-specific dependency inventory:

```sh
pnpm licenses list --prod --json > third-party-licenses.json
```

The inventory is a starting point, not a replacement for license texts or a legal
review. It covers the workspace's production JavaScript dependency graph; check
Docker services, OS packages, native libraries, fonts, and other assets separately.
The website maintains its own third-party notices, including its Shaders Pro preset.
