# @volter/twin-upstash

A local Upstash: Redis over Upstash's REST API, the one the unmodified `@upstash/redis` and `@upstash/ratelimit` call
(`https://<endpoint>.upstash.io`, this unit), the console where a database and QStash's credentials are made
(`console.upstash.com`, the `api/` lane, beside the Developer API's spec), and QStash with Workflow
(`https://qstash[-<region>].upstash.io`, the `qstash/` lane), over one vendor state.

## Use with an existing app

For an app using the supported Redis REST or QStash workflows, install the exact release:

```console
npm install --save-dev --save-exact @volter/world@3.0.67 @volter/twin-upstash@1.0.1
npx volter world init --name my-app --twins upstash --source upstash=@volter/twin-upstash
```

Review the detected vendor and generated bindings before booting. The World supplies throwaway credentials;
seed stored data through the unchanged vendor SDK, then run your app's existing test command inside the World.

```console
npx volter world up
npx volter world run -- npm test
npx volter world log
npx volter world down
```

Use your app's test command in place of `npm test`. Ordinary `down` retains state for the next `up`.


A Protocol 3 pack ([publisher guide](https://github.com/volter-ai/twin-catalog-open/blob/main/docs/contributing.md)). The Redis
unit's surface is Redis's command table (`spec/commands`), and its front (`src/semantics/around.ts`) reads Upstash's REST
forms and runs the commands with the kernel's Redis core under Upstash's dialect (`src/semantics/shared.ts`). Each lane's
surface is generated from its own spec, with handlers in `<lane>/src/semantics/<family>.ts` and state machines in
`<lane>/src/semantics/states.ts`.

```bash
world-upstash serve [--port N] [--root DIR] [--read-only]
```

## The World's Upstash

A person signs in to the console and creates a Redis database there (name, primary region, the free plan). The
database's page shows `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` and the Read Only token. On a first visit to
QStash they pick a region; the page then shows `QSTASH_URL`, `QSTASH_TOKEN` and the two signing keys, and can reset the
token and roll the keys.

## What it models

- **Redis over REST**: a command in the path (`/set/foo/bar`, a POST body as its last argument) or the body
  (`["SET", "foo", "bar"]`), `/pipeline` and `/multi-exec`, `{result}` / `{error}`, `Upstash-Encoding: base64`, `Upstash-Response-Format: resp2`
  (RESP2 bytes, but at `/multi-exec`), and a
  database's Standard and Read Only tokens (the Read Only one refuses writes, SCAN and KEYS).
- **Redis's semantics** are the kernel's (`@volter/world-core/redis`), for the commands Dub sends and the life sends
  (`src/semantics/shared.ts`, SERVED): SET, GET, GETDEL, DEL, EXISTS, EXPIRE, PEXPIRE, INCR, INCRBY, RENAME; HSET,
  HSETNX, HGET, HGETALL, HMGET, HDEL, HINCRBY; LPUSH, RPUSH, LPOP, LRANGE; SADD, SREM, SMEMBERS, SISMEMBER, SMISMEMBER;
  ZINCRBY, ZRANGE; XADD, XRANGE, XREVRANGE, XDEL; SCAN; EVAL and EVALSHA running the script's Lua (`@upstash/ratelimit`'s
  windows verbatim). Every other command is refused as Upstash refuses one it does not have, in a request or a script.
- **QStash**:
  - Publishing: publish with method, timeout, delay, not-before, retries, deduplication (ten minutes), flow control's
    keyed rate, period and parallelism (a key alone keeps its limits), durations as `<number><unit>` or compound
    (`1d1h30m`), retry-delay expressions, comma-separated labels,
    callbacks and failure callbacks, each configured by its own `Upstash-Callback-*` / `Upstash-Failure-Callback-*`
    options; batch; enqueue into a queue, and a queue's upsert; the token as a bearer header or `qstash_token`.
    A destination that is not a URL is a URL Group the account does not hold (404).
  - Messages: a message's read with configured body/header redaction; cancellation by message ids, filters, or all pending messages in the account. Redaction preserves the original payload for delivery.
  - Delivery: each message is delivered when due, signed (`Upstash-Signature`, HS256 with the current key), and
    retried on QStash's backoff, each attempt waiting at most its timeout (the account's Pay as you go plan's two hours,
    which an `Upstash-Timeout` only shortens). Once out of retries, or answered 489 with `Upstash-NonRetryable-Error:
    true`, it goes to the DLQ and its failure callback is called. A queue delivers in order, as many at a time as its
    parallelism; the attempts due at one instant are sent at once, and a call holds its key's slot until its answer
    arrives.
- **Workflow**: a run is started by its first invocation, and each later call carries the run's steps so far. It ends
  when `serve()` ends it or when it is cancelled; when a step is out of retries it fails.

## Doors

- `POST /_twin/users/{email} {password}` (console.upstash.com): a person who can sign in.
- `POST /_twin/app-credentials {owner?}` (console.upstash.com): a World application's database and QStash credentials,
  as the runtime issues them (the descriptor's credential door).
- `POST /_twin/destinations {url, status, headers?, body?, takes?, when?}` (QStash): how an application the World does
  not run answers at a URL, and after how long on the World's clock.
- `GET /_twin/deliveries?to=<url>[&run=<id>][&message=<id>]` (QStash): every request QStash made there, with its
  answer's status once it arrived, or what was missed (`timeout`, `unreachable`).

## Who it is for

Dub, as it ships (`journeys/demand.json`): its Redis caches, locks, streams and imports, its rate limits, its QStash jobs,
queues and Workflow runs, and the deliveries its routes verify. Rallly and Cal.com use Upstash Redis only when their
variables are set. The life (`journeys/customer-life.json`) is one studio's quarter on one account: Kiln on Redis,
Looplinks on QStash and Workflow.

## Not yet

- The Developer API (`api.upstash.com/v2`): no application calls it; the console makes what they use.
- QStash's schedules, URL groups, the DLQ's API, waiting for events, flow control's management API; a message
  read only while it is delivered or retried, as QStash keeps it.
- Every Redis command no demand or life sends (Upstash's table holds 248).
- Upstash Vector (Dub's docs embeddings): another product with its own wire.
