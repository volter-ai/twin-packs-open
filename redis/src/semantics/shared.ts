import { privateTransportKey, redis } from '@volter/world-core';
import { command } from '../engine/commands.ts';

export const wireKey = () => privateTransportKey('redis-resp');
export const WIRE_HEADER = 'x-volter-redis-wire';
// The literal gap set is the manifest's; command arities are generated from Redis's own command table.

// source: https://raw.githubusercontent.com/redis/redis/c9d29f6a918c335bc1778d9f68e521c1bbb36a0f/src/commands/decrby.json "Decrements a number from the integer value of a key."
// source: https://raw.githubusercontent.com/redis/redis/c9d29f6a918c335bc1778d9f68e521c1bbb36a0f/src/commands/incrby.json "Increments the integer value of a key by a number."
const allowed = new Set(["DECRBY", "INCRBY", "AUTH", "BZPOPMIN", "CLIENT", "CLIENT LIST", "CLIENT SETINFO", "CLIENT SETNAME", "DEL", "EVAL", "EVALSHA", "EXEC", "EXISTS", "EXPIRE", "GET", "HDEL", "HEXISTS", "HGET", "HGETALL", "HINCRBY", "HMGET", "HMSET", "HSET", "HVALS", "INCR", "INFO", "LINDEX", "LLEN", "LPOS", "LPUSH", "LRANGE", "LREM", "LTRIM", "MGET", "MULTI", "PERSIST", "PEXPIRE", "PING", "PTTL", "PUBLISH", "PUNSUBSCRIBE", "QUIT", "RPOP", "RPOPLPUSH", "RPUSH", "SADD", "SCAN", "SCARD", "SELECT", "SET", "SMEMBERS", "SREM", "SUBSCRIBE", "UNSUBSCRIBE", "XADD", "XTRIM", "ZADD", "ZCARD", "ZPOPMIN", "ZRANGE", "ZRANGEBYSCORE", "ZREM", "ZREMRANGEBYRANK", "ZREMRANGEBYSCORE", "ZREVRANGE", "ZREVRANGEBYSCORE", "ZSCORE"]);
const sessionCommands = ['AUTH', 'SELECT', 'CLIENT', 'INFO', 'QUIT', 'MULTI', 'EXEC', 'DISCARD', 'BZPOPMIN', 'PUBLISH', 'SUBSCRIBE', 'PSUBSCRIBE', 'UNSUBSCRIBE', 'PUNSUBSCRIBE'];
// source: https://raw.githubusercontent.com/redis/redis/c9d29f6a918c335bc1778d9f68e521c1bbb36a0f/src/server.c "unknown command"
export const unknownCommand = (argv: string[]): string => `ERR unknown command '${(argv[0] ?? '').slice(0, 128)}', with args beginning with: ${argv.slice(1).map((x) => `'${x}'`).join(' ')}`;
// source: https://raw.githubusercontent.com/redis/redis/c9d29f6a918c335bc1778d9f68e521c1bbb36a0f/src/commands/eval.json "Executes a server-side Lua script."
export const DIALECT: redis.RedisDialect = {
  unknownCommand,
  // Where the command reference stops, a malformed or unsupported form takes Redis's syntax-error class.
  unmodeled: () => 'ERR syntax error',
  shapeError(argv) {
    const cmd = (argv[0] ?? '').toUpperCase();
    const id = ['CLIENT', 'SCRIPT'].includes(cmd) && argv.length > 1 ? `${cmd} ${argv[1]!.toUpperCase()}` : cmd;
    const c = allowed.has(id) ? command(id) : undefined; if (!c) return unknownCommand(argv);
    const count = argv.length;
    return c.arity > 0 ? count === c.arity ? null : redis.wrongArity(id) : count >= -c.arity ? null : redis.wrongArity(id);
  },
  commands: Object.fromEntries(sessionCommands.map((name) => [name, [0, -1] as [number, number]])),
  exec(_space, argv) { throw new redis.RedisCommandError(unknownCommand(argv)); },
  writes: new Set(['BZPOPMIN']),
  // source: https://redis.io/docs/latest/develop/programmability/lua-api/ "cmsgpack.unpack"
  lua: { extend: redis.standardLuaLibraries, numberArg: redis.numberToLuaString },
  // source: https://redis.io/docs/latest/develop/programmability/lua-api/ "A script's effects are the Redis write commands that it calls."
  scriptErrorsKeepWrites: true,
  storage: redis.memberStorage,
};

// source: https://redis.io/docs/latest/develop/programmability/lua-api/ "against read-only replicas"
export function readOnlyWorld(commands: string[][]): Response {
  return Response.json({ items: commands.map(() => ({ error: "READONLY You can't write against a read only replica." })), wrote: false });
}

// source: https://redis.io/docs/latest/commands/set/ "Set key to hold the string value"
export function wireFailure(error: unknown, commands: string[][]): Response {
  if (!(error instanceof redis.ReadOnlyError)) throw error;
  return readOnlyWorld(commands);
}
