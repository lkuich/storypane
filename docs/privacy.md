# Privacy and data handling

Updated November 10, 2026. This describes the maintained default configuration.
Customizations, integrations, and an operator's hosting choices can change data
handling. It is not a privacy notice for every self-hosted Storypane installation.

## Self-hosted Storypane

The project distributes software; it does not operate your CMS installation or
receive your content merely because you install it. Your operator controls the
servers, databases, bucket, network access, backups, logs, and retention policies.
Self-hosting gives you that control; it does not remove obligations to your users.

| Data                                                                                                    | Default location and purpose                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Names, email addresses, password hashes, sessions, recovery records, authentication rate limits         | Installation PostgreSQL database, for local authentication and administration.                                                                                     |
| Space connection URLs                                                                                   | Encrypted in the installation database using the operator's installation encryption key.                                                                           |
| Memberships, roles, content, history, migrations, publications, schedules, and webhook delivery records | Each space's PostgreSQL database, to operate that space and enforce permissions.                                                                                   |
| Original media                                                                                          | Operator-configured private S3-compatible storage; image transformations run in the application. Public media delivery is opt-in and subject to publication rules. |
| Server, reverse-proxy, database, mail, and storage logs                                                 | Operator/provider-dependent. Requests can contain IP addresses, paths, identifiers, and user agents. Configure access and retention deliberately.                  |

Local authentication requires session cookies. Those are functional login
cookies, not advertising identifiers. The default application does not configure
advertising or product-analytics tracking. Better Auth telemetry is not enabled
in the maintained configuration. This is not a guarantee about every dependency,
customized deployment, network provider, or future release.

## External services are your choice

- **Clerk:** when selected, authentication and associated identity/session data
  are processed by your Clerk instance. Its policies and service terms apply.
- **SMTP:** invitations and password resets send recipient addresses and private
  links through your selected mail provider.
- **Webhooks and external data sources:** configured receivers and services receive
  the requests/data your integration sends. Restrict host allowlists and review
  payloads before enabling them.
- **Agents and MCP:** Storypane does not need a built-in hosted LLM. The agent you
  connect can read or change content within its credentials' permissions. Your
  agent/model provider may process that content under its own terms. Give it only
  the access you intend; do not paste passwords or production secrets into chat.
- **Your website/CDN:** publishing exposes the selected content through your own
  frontend and any cache/CDN you configure. A database deletion does not purge
  downstream copies automatically.

## Operator responsibilities

Before inviting users, publish your own privacy notice with the responsible
operator and contact method, purposes, actual providers/regions, access controls,
retention periods, and a process for access/correction/deletion requests. Choose
backup retention and test recovery. Include installation accounts, space content,
original media, logs, provider records, and backups in your retention plan.

The RC does not provide a complete privacy-request, account-erasure, or retention
automation workflow. Deleting a membership is not erasing an account, content,
publication history, webhook records, or backups. Plan authorized deletion with
an operator and verify references and required records before changing data.
Do not promise regulatory compliance solely because the software is self-hosted.

## storypane.dev

The marketing site and documentation are static assets served through Cloudflare. The site has no signup form and does not connect to your self-hosted CMS. Production pages use Sarge to record page views, GitHub and Railway link clicks
(including destination URLs and link labels), page URLs, referrers, titles,
and pseudonymous session/user identifiers.

Sarge stores identifiers and optional
campaign attribution in browser local storage and can observe existing Meta,
Google, and dataLayer calls. See [Sarge's privacy policy](https://sargetrack.app/legal/privacy). Shader telemetry is disabled. Cloudflare processes requests to serve and secure
the website; see [Cloudflare's privacy policy](https://www.cloudflare.com/privacypolicy/). Provider logs and retention are governed by the site's hosting configuration;
this document does not claim zero logging.

The experimental `/grid-shift` page loads Mona Sans from Google Fonts, which
sends the font request and usual request metadata to Google. The main site uses
locally hosted fonts. See [Google Fonts privacy information](https://developers.google.com/fonts/faq/privacy).
Following links to GitHub, npm, or other services is subject to their policies.

For questions about the project's published practices, [contact the maintainer
through GitHub](https://github.com/lkuich). Do not post personal data or secrets
in a public issue. For a self-hosted account or content request, contact **your
installation's operator**; the project maintainer does not have access to it.
