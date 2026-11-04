# @volter/twin-vercel

A local Vercel. Its REST API (`api.vercel.com`) serves the calls Dub makes for its customers' domains and its Edge
Config writes; Dub and Cal.com read Edge Config at its read host (`edge-config.vercel.com`, what `@vercel/edge-config`
reads). Around them are the dashboard pages (`vercel.com`) where the token, the Edge Config and its connection string
are made.

A Protocol 3 pack ([architecture](../../twin-world/docs/contributing/architecture.md), "Protocol 3"). Its surface is generated
from Vercel's published OpenAPI document (`spec/`). Handlers are in `src/semantics/<family>.ts`, pages in `src/screens`,
and state machines in `src/semantics/states.ts`.

```bash
world-vercel serve [--port N] [--root DIR] [--read-only]
```

## What it models

- **Project domains**:
  - **Adding one**: attached to the project (and the apex to the team). Verified at once, unless another Vercel account
    holds the apex; then it answers a TXT challenge at `_vercel.<apex>`, and a verify checks that record.
  - **Reading and removing**: read, removed, and the team domain deleted with the project domains under it.
- **A domain's configuration**: as Vercel sees the domain's DNS. A CNAME to `cname.vercel-dns-0.com` or the A record
  `76.76.21.21` at the owner's DNS host counts, as does a Vercel zone its registrar delegates to Vercel's nameservers.
  Anything else is misconfigured, with the records Vercel recommends.
- **A team domain made a zone**: `patchDomain` with `op: update` and `zone`.
- **Edge Config**:
  - Items are written through PATCH /v1/global-config/{id}/items or Dub's /v1/edge-config/{id}/items (`create`, `update`, `upsert`, `delete`), one subject each.
  - They are read at `edge-config.vercel.com/<id>/item/<key>` with the store's read token. A missing key answers 404
    with the store's digest; `/<id>/items` answers every item, or only those `key` parameters name (`getAll`).
- **The dashboard**:
  - the email sign-in with a one-time password (emailed; one use, ten minutes);
  - Account Tokens (a name, a team scope and an expiration, shown once; deleted);
  - the team's Storage (an Edge Config, and its connection string once a project is connected).
- **Access tokens**: acts in its scope's team. A deleted or expired one is refused `403` with `invalidToken`.
- **Vendor-backed**: the team's projects, project domains, domains, teams Edge Configs and their items are listed for a refresh;
  Vercel's webhooks are ingested by `x-vercel-signature` (project-domain and project events).

## Doors

- `POST /_twin/users/{email} {team}`: a person's account and Pro team.
- `POST /_twin/app-credentials {team?, project?}`: an application's token, team and project ids, and Edge Config
  connection string.
- `GET /_twin/mailbox/{email}`: the mail Vercel sent them.
- `POST /_twin/projects {team, name}`: the project a Git import made.
- `POST /_twin/registrar/nameservers {domain, nameservers}`: a registrar's nameservers.
- `POST /_twin/dns {name, type, value}`: a record at the owner's DNS host.
- `POST /_twin/claimed {domain}`: an apex another account holds.

## Not yet

- Creating projects, deployments, environment variables, team domains and DNS records through the API: no application
  makes them so.
