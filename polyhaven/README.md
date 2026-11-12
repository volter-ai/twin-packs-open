# @volter/twin-polyhaven

The Poly Haven twin (Protocol 3), serving what Volter Editor's asset library calls
([journeys/demand.json](./journeys/demand.json), [journeys/decisions.json](./journeys/decisions.json)). Two lanes over
one store:

- **`api`** (api.polyhaven.com, Poly Haven's own OpenAPI document): `/assets` (every asset of a type keyed by its id,
  narrowed to all of the categories named), `/categories/{type}` (each category's count, with `all`; `all` as the type
  counts the types) and `/files/{id}` (an asset's files tree: each file's url, size and md5). Errors are Poly Haven's
  text: an unsupported type is 400, an unknown id 404.
- **`dl`** (dl.polyhaven.org, the ph-assets Backblaze B2 bucket, and cdn.polyhaven.com): a file's bytes by its name,
  with `X-Bz-File-Name` and `X-Bz-Content-Sha1` (B2's `not_found` for a name no file has), and an asset's thumbnail.

The API only reads. The World's catalog is published through `POST /_twin/assets` ({ id, type, name, categories,
tags?, authors?, files, thumbnail? }): an asset, its files' bytes and its thumbnail, answered as `/info` shows it.

The consumer's work is the public data and download API: no account credentials or console screens are required.
The publishing door stands in for the library team's publishing workflow, which has no public mutation API.
Catalog metadata refreshes through the complete keyed /assets response. File payloads and thumbnails are local
publisher fixtures in the blob store; this pack does not download upstream payloads on refresh.
Author, info, search, taxonomy and type-discovery endpoints are explicit gaps. The API routes above serve the
editor's type and legacy-category filters; newer taxonomy/attribute/collection/vault filters are outside this demand.
The kernel applies its fallback rate budget (30 calls per minute); the cited specification gives no scalar allowance.

For a caller using literal public URLs, explicitly select this vendor in the World config. With the package
installed in the app, a colocated service declaration is:

```json
{
  "schemaVersion": 2,
  "metadata": { "id": "polyhaven-import" },
  "runtime": { "isolation": "colocated" },
  "services": [{
    "id": "polyhaven",
    "type": "twin",
    "source": { "package": "@volter/twin-polyhaven", "version": "1.0.0" },
    "execution": { "colocate": { "export": "createPolyhavenTwinServer" } },
    "endpoint": { "port": "auto" }
  }]
}
```

Start and attach through the [World operator CLI](https://github.com/volter-ai/twin-world/blob/main/docs/reference/cli.md).
Seed through `https://api.polyhaven.com/_twin/assets` inside that World, then run the app inside it and stop it
through `down`. Publishing returns **201**, an already-published id **409**, and invalid publishing inputs **400**.
`GET /twin` describes the publishing door's full input: each file leaf supplies `text` or `base64`, and an optional
`include` map supplies dependent files in the same format. `thumbnail` supplies a base64 PNG. The vendor API and
download URLs returned by the file manifest keep their public hostnames and are routed by the World.
