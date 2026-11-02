# planetscale spec — provenance

The psdb data plane that `@planetscale/database` calls: the Connect RPC service `psdb.v1alpha1.Database`, published as
Protocol Buffers with every file it imports.

- **Files:** `proto/`, as published:
  - `proto/psdb/**` from https://github.com/planetscale/psdb, `proto-src/` at commit `6e407b36dd2af61dc1892e7afdb8ca52b42d3231` (2026-05-12).
  - `proto/vitess/**` from https://github.com/planetscale/vitess-types, `src/` at commit `d3c6b151b0f9bcdfb4932b8cfaf5b0735c4d436b`: the `v22` packages `database.proto` imports, and theirs. psdb's `buf.lock` pins them as `buf.build/planetscale/vitess` commit `5b7c5f01d66e46969fcc8b4fee3ba31c`; the files are read from the same packages' GitHub mirror. Where the evidence stops: that the mirror at this commit holds the same bytes as that buf commit is not checked (no buf CLI here).
- **Spec version:** the service `psdb.v1alpha1.Database` (`CreateSession`, `Execute`, `StreamExecute`, `Prepare`, `CloseSession`).
- **SHA-256 of each file:**
  - `proto/psdb/data/v1/data.proto`: `3de8c060b7eda767e5734ea8ea4ad8d600ee9df8a24e9031cd13ed91efbab9f9`
  - `proto/psdb/v1alpha1/database.proto`: `cb687864c4b2d755f0f0543cbf41595cf36ec4bbd8975bdb64db99b8d010e59d`
  - `proto/vitess/binlogdata/v22/binlogdata.proto`: `dc87b193781cd1076f2069dcf59e74655ebcb8c10de3dc18df2c407b007bcf3c`
  - `proto/vitess/query/v22/query.proto`: `d7af995ea5aeb2d4ed3367e29fd1613c558524c91db943907af17ec8e85df4c6`
  - `proto/vitess/topodata/v22/topodata.proto`: `d6e12d0fe33f173b6dfb2a954c07a5fd2b47b384c34e91113c2c055f70c4c800`
  - `proto/vitess/vtgate/v22/vtgate.proto`: `b2964ff4f6425471f6e4d44031ebc3f6a4f87cc067044720e2d5eeb9285be7a7`
  - `proto/vitess/vtrpc/v22/vtrpc.proto`: `0f389cb7402bcf8ff8c643b5bdf787f2d4dce1174980db1b73592a2476aa3a5f`
  - `proto/vitess/vttime/v22/vttime.proto`: `5fcff8ca85e6888b77d6bbdb2c4aeead2f0962bb389d7ef20b745bbdd796f087`
- **Corrections:** none.
- **Read by:** `bun ../twin-world/scripts/derive-pack.ts planetscale` (twin-world's `packages/twin-standard/src/spec-ir-proto.ts`), which writes `../src/generated/surface.gen.json`.
- **Outside this spec:** the management API at `api.planetscale.com` and the dashboard at `app.planetscale.com`, served by the `api/` lane.

## The MySQL 8.0 manual's examples (`doc-examples.json`)

The engine behind Execute cites the MySQL 8.0 Reference Manual as its semantics, and the manual prints worked examples
(`mysql>` statements and their results). They are vendored by function section: each vendored section's description
and every example in it, whole, as an SQL engine's function is what an operation is to a REST spec; the small pages on
precision math, cast functions, arithmetic operators, flow control, JSON attributes and binary collations whole. Each
entry is `{title, source (the page and section), operation: Execute, input: {query}, means}`: the statement as printed
and what the manual prints for it. `journeys/vendor-examples.json` replays each through Execute with a live admin
password; `notReplayed` names the few no World replays (a generated column, a sleep another session kills, the
MAX_EXECUTION_TIME optimizer hint, a placeholder table name, and the examples that need a text character set other than
utf8mb4 or binary, which the twin does not model), and a step's `exampleDiffers` says why MySQL 8 in a World prints otherwise (the clock, the session time
zone, the server's version, the manual's shorthand). Tables the manual creates only in prose are setup steps with the
manual's own columns.

Fetched 2026-09-26 from https://dev.mysql.com/doc/refman/8.0/en/. Per page:

- [aggregate-functions](https://dev.mysql.com/doc/refman/8.0/en/aggregate-functions.html): vendored avg, count, count-distinct, group-concat, json-arrayagg, max, min, sum. Not vendored, not modelled and outside the count until served: bit-and, bit-or, bit-xor, json-objectagg, std, stddev, stddev-pop, stddev-samp, var-pop, var-samp, variance.
- [json-search-functions](https://dev.mysql.com/doc/refman/8.0/en/json-search-functions.html): vendored json-contains, json-extract, json-column-path, json-inline-path, member-of. Not vendored, not modelled and outside the count until served: json-contains-path, json-keys, json-overlaps, json-search, json-value.
- [json-modification-functions](https://dev.mysql.com/doc/refman/8.0/en/json-modification-functions.html): vendored json-unquote. Not vendored, not modelled and outside the count until served: json-array-append, json-array-insert, json-insert, json-merge, json-merge-patch, json-merge-preserve, json-remove, json-replace, json-set.
- [json-creation-functions](https://dev.mysql.com/doc/refman/8.0/en/json-creation-functions.html): vendored json-array, json-object, json-quote. Not vendored, not modelled and outside the count until served: none.
- [date-and-time-functions](https://dev.mysql.com/doc/refman/8.0/en/date-and-time-functions.html): vendored convert-tz, curdate, current-date, current-timestamp, date-format, get-format, localtime, localtimestamp, now, unix-timestamp, utc-timestamp, str-to-date, curtime, current-time, utc-time, utc-date, sysdate, from-unixtime. Not vendored, not modelled and outside the count until served: adddate, addtime, date, date-add, date-sub, datediff, day, dayname, dayofmonth, dayofweek, dayofyear, extract, from-days, hour, last-day, makedate, maketime, microsecond, minute, month, monthname, period-add, period-diff, quarter, sec-to-time, second, subdate, subtime, time, time-format, time-to-sec, timediff, timestamp, timestampadd, timestampdiff, to-days, to-seconds, week, weekday, weekofyear, year, yearweek.
- [string-functions](https://dev.mysql.com/doc/refman/8.0/en/string-functions.html): vendored char-length, character-length, concat, lcase, length, lower, ltrim, octet-length, rtrim, trim, ucase, upper, hex, unhex. Not vendored, not modelled and outside the count until served: ascii, bin, bit-length, char, concat-ws, elt, export-set, field, find-in-set, format, from-base64, insert, instr, left, load-file, locate, lpad, make-set, mid, oct, ord, position, quote, repeat, replace, reverse, right, rpad, soundex, space, substr, substring, substring-index, to-base64, weight-string, sounds-like.
- [string-comparison-functions](https://dev.mysql.com/doc/refman/8.0/en/string-comparison-functions.html): vendored like, not-like, strcmp (LIKE's first two examples, under latin1_german2_ci, are notReplayed). Not vendored, not modelled and outside the count until served: none.
- [comparison-operators](https://dev.mysql.com/doc/refman/8.0/en/comparison-operators.html): vendored coalesce, greatest, least, between, equal, equal-to, exists, greater-than, greater-than-or-equal, in, is, is-not, is-not-null, is-null, less-than, less-than-or-equal, not-between, not-equal, not-exists, not-in. Not vendored, not modelled and outside the count until served: interval, isnull.
- [mathematical-functions](https://dev.mysql.com/doc/refman/8.0/en/mathematical-functions.html): vendored abs, round, conv, mod. Not vendored, not modelled and outside the count until served: acos, asin, atan, atan2, ceil, ceiling, cos, cot, crc32, degrees, exp, floor, ln, log, log10, log2, pi, pow, power, radians, rand, sign, sin, sqrt, tan, truncate.
- [information-functions](https://dev.mysql.com/doc/refman/8.0/en/information-functions.html): vendored database, schema, version. Not vendored, not modelled and outside the count until served: benchmark, charset, coercibility, collation, connection-id, current-role, current-user, found-rows, icu-version, last-insert-id, roles-graphml, row-count, session-user, system-user, user.
- [miscellaneous-functions](https://dev.mysql.com/doc/refman/8.0/en/miscellaneous-functions.html): vendored values, sleep. Not vendored, not modelled and outside the count until served: any-value, bin-to-uuid, default, grouping, inet-aton, inet-ntoa, inet6-aton, inet6-ntoa, is-ipv4, is-ipv4-compat, is-ipv4-mapped, is-ipv6, is-uuid, name-const, uuid, uuid-short, uuid-to-bin.
- [bit-functions](https://dev.mysql.com/doc/refman/8.0/en/bit-functions.html): vendored bitwise-or, bitwise-and, bitwise-xor, left-shift, right-shift, bitwise-invert. Not vendored, not modelled and outside the count until served: bit-count.
- [precision-math-examples](https://dev.mysql.com/doc/refman/8.0/en/precision-math-examples.html): vendored whole.
- [cast-functions](https://dev.mysql.com/doc/refman/8.0/en/cast-functions.html): vendored whole (its three _latin1/_latin2 examples are notReplayed).
- [arithmetic-functions](https://dev.mysql.com/doc/refman/8.0/en/arithmetic-functions.html): vendored whole.
- [flow-control-functions](https://dev.mysql.com/doc/refman/8.0/en/flow-control-functions.html): vendored whole.
- [json-attribute-functions](https://dev.mysql.com/doc/refman/8.0/en/json-attribute-functions.html): vendored whole.
- [charset-binary-collations](https://dev.mysql.com/doc/refman/8.0/en/charset-binary-collations.html): vendored whole.

The language beyond these sections is outside the count until modelled. Generated columns are not modelled: the
examples whose setup declares one are recorded, not replayed.

## SQL metadata and statement rules (`doc-examples.json`)

The examples journey also replays the MySQL 8.0 manual's stated rules for existing Execute semantics:

- `information-schema-columns-table`, `information-schema-tables-table`, `information-schema-statistics-table`,
  `information-schema-table-constraints-table`, `information-schema-key-column-usage-table`, and
  `information-schema-schemata-table`: declared types, indexes, constraints and names read back from the actual tables.
- `year`, `enum`, `show-tables`, `comparison-operators`, `group-by-handling`, `charset-unicode-sets`,
  `charset-collation-coercibility`, `type-conversion`, `json`, `json-search-functions`,
  `aggregate-functions`, `insert-on-duplicate`, `delete`, `alter-table`, and `truncate-table`: conversions, comparisons,
  refusal classes, inserted-row aliases and the effects of statements. The row and column alias requests are the
  INSERT statements printed on `insert-on-duplicate`; each other entry says which stated rule it replays.
- [MySQL's error reference](https://dev.mysql.com/doc/mysql-errors/8.0/en/server-error-reference.html): malformed SQL
  (1064 / 42000), unknown collation (1273 / HY000) and a collation not valid for its character set (1253 / 42000).
  The error class is asserted; the pages give no parser position
  for the journey's malformed query.
- [PlanetScale's compatibility reference](https://planetscale.com/docs/reference/mysql-compatibility): CREATE DATABASE
  cannot make a logical database within a branch.
- [PlanetScale's system limits](https://planetscale.com/docs/reference/planetscale-system-limits): a query returning
  more than 100000 rows is refused. A 317-row fixture, created through Execute and cross-joined to itself, establishes
  that precondition without state injection. The page gives the limit, not this refusal's precise text or errno.

Every entry carries its page URL in `doc-examples.json`, the information schema, collation and GROUP BY entries quoting
the manual's sentences in `means` (each also a `// source:` line in `../src/semantics/shared.ts`, where check-sources
reads it); MySQL section names above resolve under
`https://dev.mysql.com/doc/refman/8.0/en/<section>.html`. Pages were read through twin-standard's `read-page`. The
setup statements create only the preconditions those rules need, and later reads assert their effects.
