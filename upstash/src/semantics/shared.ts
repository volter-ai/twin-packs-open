// Upstash Redis's dialect of the kernel's Redis core (architecture, "Other wires": a vendor that carries Redis over
// HTTP): its refusals, the commands its REST API will not take, and its Lua. The error strings were probed off a real
// Upstash database (redis_version 8.2.0) when the upstash pack was first built (2026-08-19); each is the vendor's text.
import { redis } from '@volter/world-core';

type Row = Record<string, unknown>;

/** A command neither the kernel's core nor Upstash serves: Upstash's own words, not stock Redis's "unknown command". */
export function unavailable(name: string): string {
  return `ERR Command is not available: '${name.toUpperCase()}'. See https://upstash.com/docs/redis/overall/rediscompatibility for details`;
}

/** The commands the REST API refuses outright: connection, transaction and pub/sub control, which mean nothing over
 *  stateless HTTP ("Connection: Only PING and ECHO are supported"; "WATCH/UNWATCH/DISCARD are not supported"; a
 *  transaction is `/multi-exec`, a subscription its own path; restapi, "REST - Redis API Compatibility"). */
// source: https://upstash.com/docs/redis/features/restapi "WATCH/UNWATCH/DISCARD are not supported"
export const REST_RESTRICTED = new Set(['AUTH', 'MULTI', 'EXEC', 'DISCARD', 'WATCH', 'UNWATCH', 'HELLO', 'RESET', 'SUBSCRIBE', 'UNSUBSCRIBE', 'PSUBSCRIBE', 'PUNSUBSCRIBE', 'CLIENT', 'MONITOR']);
const restricted = (name: string): string => `ERR Command "${name.toUpperCase()}" is not allowed in REST or it has a special context path`;

/** The commands the twin serves: those the demand calls (Dub's, through @upstash/redis, the scripts of its lock and of
 *  @upstash/ratelimit, and ratelimit's analytics: ../../journeys/demand.json) and those the life calls (HINCRBY, ZRANGE:
 *  ../../journeys/customer-life.json), each decided in ../../journeys/decisions.json. Every other command of Upstash's
 *  table is the gap, answered as Upstash answers a command it does not have, in a request and in a script alike. */
export const SERVED = new Set([
  'SET', 'GET', 'GETDEL', 'DEL', 'EXISTS', 'EXPIRE', 'PEXPIRE', 'INCR', 'INCRBY', 'RENAME',
  'HSET', 'HSETNX', 'HGET', 'HGETALL', 'HMGET', 'HDEL', 'HINCRBY',
  'LPUSH', 'RPUSH', 'LPOP', 'LRANGE',
  'SADD', 'SREM', 'SMEMBERS', 'SISMEMBER', 'SMISMEMBER',
  'ZINCRBY', 'ZRANGE',
  'XADD', 'XRANGE', 'XREVRANGE', 'XDEL',
  'SCAN', 'EVAL', 'EVALSHA',
]);

/** The dialect adds no command of its own (`commands` is empty), so the core never runs one through it: a guard. */
function noCommandsOfItsOwn(_space: unknown, argv: string[]): never {
  throw new redis.RedisCommandError(unavailable(argv[0] ?? ''));
}

export const DIALECT: redis.RedisDialect = {
  unknownCommand: (argv) => unavailable(argv[0] ?? ''),
  // an option of a served command the core does not model: refused by name, never answered as another
  unmodeled: (what) => `ERR twin: ${what} is not modeled`,
  shapeError: (argv) => {
    const name = (argv[0] ?? '').toUpperCase();
    if (REST_RESTRICTED.has(name)) return restricted(name);
    const arity = SERVED.has(name) ? redis.SERVED_COMMANDS[name] : undefined;
    if (arity === undefined) return unavailable(name);
    const n = argv.length - 1;
    return n < arity[0] || (arity[1] !== -1 && n > arity[1]) ? redis.wrongArity(name) : null;
  },
  commands: {},
  exec: noCommandsOfItsOwn,
  writes: new Set(),
  // a script calls the command API as `redis`, and a Lua number passed to a command is truncated toward zero (3.7 is 3)
  lua: { extend: ({ set, commandApi }) => set('redis', commandApi), numberArg: (n) => String(Math.trunc(n)) },
  // a script that fails part-way leaves nothing it wrote (probed: a SET before the script's error is gone)
  scriptErrorsKeepWrites: false,
};

/** The database a REST request reaches: the one whose endpoint is the request's host (`<endpoint>.upstash.io`). */
export function databaseAt(rows: Row[], host: string): Row | undefined {
  const endpoint = host.replace(/\.upstash\.io$/, '');
  return rows.find((d) => d.endpoint === endpoint && d.deleted !== true);
}
