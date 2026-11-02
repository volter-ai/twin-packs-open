# planetscale/api spec — provenance

- **File:** `openapi.json.gz`, gzip of PlanetScale's published management API document (Swagger 2.0), as the API
  serves it: https://api.planetscale.com/v1/openapi-spec, fetched 2026-09-26.
- **Spec version:** `v1` (`info.version`); host `api.planetscale.com`, base path `/v1`; 291 operations.
- **SHA-256 of the uncompressed document:** `c52e6e4f3fe27ebdb2f4d7b596cadeefaffb38d5746f7feb1ab3ec1846937e1d`.
- **Corrections:** none.
- **Read by:** `bun ../twin-world/scripts/derive-pack.ts planetscale/api`, which writes `../src/generated/`.
- **Outside this spec:** the psdb data plane the pack root serves (`../../spec/proto/`), and the organization's settings
  pages where the first service token is made.
- **Where the evidence stops:** `create_password`'s `role` has no default in the spec or its reference page. The twin
  takes `reader` for a replica password and `admin` otherwise: the CLI flag's documented default
  (https://planetscale.com/docs/cli/password, `--role`: "Defaults to `reader` for `--replica` and `--read-only-region`,
  otherwise `admin`"), inferred for the API, which states none.

## Backup option rules

`doc-examples.json` records the reference's retention units and 1..1000 value bounds and its PostgreSQL-only emergency
backup constraint. The examples journey reaches those rules on a Vitess/MySQL database. The page's generic sample
sets `emergency: true`, requiring the separate PostgreSQL flow; that sample is recorded outside this pack's scope,
rather than silently ignoring its option. The reference gives the constraint but no status or body for a Vitess
emergency backup's refusal; the twin answers the operation's documented 422, its code and words the twin's. The
reference gives no length for a `month` or `year` retention; the twin adds them as calendar units, clamped to the target
month's last day as [Temporal's add](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal/PlainDateTime/add)
constrains a date.
