# upstash spec — provenance

Upstash Redis serves Redis commands over its REST API (upstash.com/docs/redis/features/restapi): a command and its
arguments in the path (`/COMMAND/arg1/..`) or the body (`["SET", "foo", "bar"]`), several at once at `/pipeline` and
`/multi-exec`. The commands are Redis's, and Redis publishes each as a machine-readable file.

- **Files:** `commands/`, one file per command, as published at https://github.com/redis/redis `src/commands/` at tag
  `8.4.7` (commit `4039944d4f8817d7e15f184c0bbb29f946535364`). Upstash's compatibility page: "Upstash supports Redis client protocol up to version `8.4`".
- **Version:** `8.4.7`
- **Which commands:** those Upstash's own command reference lists (upstash/docs `redis/commands/<group>/<command>.mdx`
  at commit `3165edff5b5edf4ba74508a4d3583b257297b9e4`) that Redis's table holds: 248 of its 313.
- **Not in Redis's table, so not vendored here:** Upstash's own families (Array `AR*`, `SEARCH.*`, `VECTOR.*`),
  the JSON commands (a Redis module, not the core table), `ACL GENTOKEN`/`ACL RESTTOKEN`, `SDIFFCARD` and
  `SUNIONCARD`. They are outside the count until modelled, from Upstash's pages.
- **The wire:** the REST envelope is Upstash's page's words, not a machine spec; the pack states each form it serves
  with the page cited.
- **SHA-256 of each file:** `commands.sha256` beside this file.
- **Corrections:** none.
- **Read by:** `bun scripts/derive-pack.ts upstash` (`packages/twin-standard/src/spec-ir-commands.ts`).

## Redis's worked examples (`doc-examples.json`)

Each command page of redis.io prints worked examples in its Examples section: redis-cli statements and what each
answers. They are vendored from the pages' source, https://github.com/redis/docs `content/commands/<command>.md` at
commit `e9856ec64b12c23e492b63b2b341d8f83a4e09e8` (rendered at `https://redis.io/docs/latest/commands/<command>/`), for
every command the twin served when they were vendored, Dub's commands first: 88 pages, 385 statements, every
statement of each page's Examples section in the page's order. The twin now serves the commands the demand and the life
send (`src/semantics/shared.ts`, SERVED); a page's statement of another command is counted, not replayed, and where the
page's later examples read what it wrote, a served command makes the same state (MSET as SETs, ZADD as ZINCRBYs) or
those examples are recorded in `notReplayed` with why. Each entry is `{title, source, operation, input, output, means}`:
the page's URL, the statement's command (its id in the command table), the statement as a JSON array, and what the page
prints for it, transcribed as the REST result/error that the replay compares. `journeys/vendor-examples.json` replays each page's statements in order through `POST /` with a live
Standard token of a database the console made, each page from an empty database (the keys the pages before it wrote deleted); a step's `exampleDiffers` says why a World answers otherwise (the
page's clock in stream ids, a random pick, Redis 8.6 commands past the 8.4 Upstash serves, a mistyped reply).

SCAN's page has no Examples section and prints its examples in its body (its iteration, MATCH, TYPE and NOVALUES
sections): they are vendored with the rest, in the page's order. Those that iterate the page's pre-existing keyspace by its
server's cursors, and those that read what GEOADD would have written, are recorded in `notReplayed`; SSCAN, HSCAN and
GEOADD are commands the twin does not serve. Pages with no examples at all: DBSIZE, EVALSHA, EVALSHA_RO, FLUSHALL,
FLUSHDB, RANDOMKEY, SCRIPT EXISTS, SCRIPT FLUSH, SCRIPT LOAD, SELECT.

Upstash's REST API page (https://upstash.com/docs/redis/features/restapi) prints the wire's own examples: its `curl`
requests (path-style, the `_token` parameter, a value in the body, the command in the body, base64 answers, RESP2,
`/pipeline`, `/multi-exec`, `/monitor`, `/subscribe`, `/publish`, `/info`) and what each answers. They are vendored as
`restapi <title>` entries, each request as the page sends it. The SSE endpoints (MONITOR, SUBSCRIBE), PUBLISH and INFO
are commands the twin does not serve (the gap), and the RESP2 response format is recorded in `notReplayed`: the twin
does not model it.
