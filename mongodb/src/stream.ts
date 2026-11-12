// MongoDB's wire in front of the pack: the kernel frames the messages (@volter/world-core/mongodb); each command
// document goes to the pack's own fetch on a private transport and its answer comes back as the reply document.
import { mongodb, type PackFetchOptions, type TwinStream } from '@volter/world-core';
import { createMongodbFetch, loadBson } from './fetch.ts';
import { WIRE_HEADER, wireKey } from './semantics/shared.ts';

// BSON is the pack's own library, loaded as the generated fetch supplies it (architecture, the MongoDB wire).
const { Double, EJSON, Int32, Long, deserialize, serialize } = await loadBson() as mongodb.BsonLibrary;

// A value's BSON type survives the wire in both directions: nothing is promoted to a JavaScript number on the way in,
// and the engine answers in canonical extended JSON, which names each number's kind.
// source: recording:insert-two.json "$numberDouble"
const codec: mongodb.MongoCodec = {
  serialize: (document) => serialize(document),
  deserialize: (bytes) => deserialize(bytes, { promoteValues: false, promoteLongs: false, bsonRegExp: true }),
};

// How long each kind of command took in this process, from the command document read off the wire to its reply
// document: what a slow boot against the pack is read from before anything is changed for speed.
const times = new Map<string, { count: number; total: number; longest: number }>();
/**
 * The same, said while the twin serves (S2 R17): one `[mongo-twin]` line every WINDOW_MS that served any command,
 * as the Redis twin's `[redis-twin]` line is. `commandTimes` printed only at the twin's stop, so a run that ends with
 * the World still up (every dry run) had no account of a database's startup queries. Per command kind: count, total
 * and longest service time (read off the wire to reply); `concurrentMax`, the most commands in service at once (overlapping service, without attributing its cause); and the slowest command of the window.
 */
const WINDOW_MS = 2000;
let windowTimes = new Map<string, { count: number; total: number; longest: number }>();
let inService = 0, concurrentMax = 0, slowest: { name: string; database: string; ms: number } | undefined, windowTimer: ReturnType<typeof setTimeout> | undefined;
function sayWindow(): void {
  windowTimer = undefined;
  if (windowTimes.size === 0) return;
  const commands = [...windowTimes.entries()].sort((a, b) => b[1].total - a[1].total)
    .map(([name, held]) => ({ name, count: held.count, totalMs: Math.round(held.total * 10) / 10, longestMs: Math.round(held.longest * 10) / 10 }));
  console.error(`[mongo-twin] ${JSON.stringify({ windowMs: WINDOW_MS, commands, concurrentMax, ...(slowest ? { slowest: { ...slowest, ms: Math.round(slowest.ms * 10) / 10 } } : {}) })}`);
  windowTimes = new Map(); concurrentMax = inService; slowest = undefined;
}
function countWindow(name: string, database: string, took: number): void {
  const held = windowTimes.get(name) ?? { count: 0, total: 0, longest: 0 };
  windowTimes.set(name, { count: held.count + 1, total: held.total + took, longest: Math.max(held.longest, took) });
  if (!slowest || took > slowest.ms) slowest = { name, database, ms: took };
  if (!windowTimer) { windowTimer = setTimeout(sayWindow, WINDOW_MS); (windowTimer as { unref?: () => void }).unref?.(); }
}
/** One line for each kind of command served, slowest in total first: count, total and longest in milliseconds. */
export const commandTimes = (): string[] => [...times.entries()].sort((a, b) => b[1].total - a[1].total).map(([name, held]) => `mongodb times: ${name} count ${held.count} total ${held.total.toFixed(0)} ms longest ${held.longest.toFixed(1)} ms`);

/**
 * AN AWAITABLE HELLO. A driver's server monitor asks `hello` with the topologyVersion it last saw and a
 * maxAwaitTimeMS, and with exhaustAllowed where it will take a stream of replies. What the server does is WHEN it
 * answers, and that is said here as data: this pack holds no clock, the kernel's wire does the waiting and the
 * repeating (`timedReply`), and the reply itself is the engine's hello, the same for the same request.
 *  - the server's own current version: answered after maxAwaitTimeMS; with exhaustAllowed, again every
 *    maxAwaitTimeMS, each reply marked moreToCome.
 *    source: recording:hello-awaitable-no-exhaust.json "received"
 *    source: recording:hello-awaitable-exhaust.json "received"
 *  - another process's version (a driver's memory of a server since restarted; a twin's processId is derived from
 *    its World, so a World made anew is that): answered at once; with exhaustAllowed the stream then runs.
 *    source: recording:hello-stale-process.json "received"
 *    source: recording:hello-stale-process-exhaust.json "received"
 *  - its own process with a greater counter: refused, the connection kept.
 *    source: recording:hello-counter-ahead.json "Received a topology version with counter: 1 which is greater than the server topology version counter: 0"
 * Where the recordings stop: its own process with a LESSER counter (a standalone's counter is 0 and has none below
 * it); answered at once here, as a version that is not current is. And a server ending a stream itself: a twin
 * never does.
 */
function awaited(name: string, command: mongodb.MongoDocument, reply: mongodb.MongoDocument, asked: mongodb.MongoAsked): mongodb.MongoDocument | mongodb.MongoTimedReply | undefined {
  if (name !== 'hello' && name !== 'isMaster' && name !== 'ismaster') return undefined;
  const given = command.topologyVersion as { processId?: unknown; counter?: unknown } | undefined | null;
  const own = reply.topologyVersion as { processId?: unknown; counter?: unknown } | undefined | null;
  if (command.maxAwaitTimeMS === undefined || !given || !own) return undefined;
  const wait = Number(String(command.maxAwaitTimeMS));
  if (!Number.isFinite(wait) || wait < 0) return undefined;
  if (String(given.processId) !== String(own.processId)) return asked.exhaustAllowed ? mongodb.timedReply(reply, 0, wait) : reply;
  let theirs: bigint, ours: bigint;
  try { theirs = BigInt(String(given.counter)); ours = BigInt(String(own.counter)); } catch { return undefined; }
  if (theirs > ours) return { ok: new Double(0), errmsg: `Received a topology version with counter: ${theirs} which is greater than the server topology version counter: ${ours}`, code: new Int32(51764), codeName: 'Location51764' };
  if (theirs < ours) return asked.exhaustAllowed ? mongodb.timedReply(reply, 0, wait) : reply;
  return mongodb.timedReply(reply, wait, asked.exhaustAllowed ? wait : undefined);
}

export function createMongodbTwinStream(options: PackFetchOptions & { replicaSet?: import('./engine/replica-handshake.ts').SingleMemberHandshake } = {}): TwinStream {
  const fetch = createMongodbFetch(options);
  return mongodb.createMongoStream({
    codec,
    open: () => ({}),
    async command(_session, database, command, asked) {
      const name = Object.keys(command)[0] ?? '', started = performance.now();
      inService += 1; concurrentMax = Math.max(concurrentMax, inService);
      const said = (): string => `[${name} on ${database}.${String(command[name])}: ${JSON.stringify(EJSON.serialize(command, { relaxed: true })).slice(0, 600)}]`;
      // The server's status names the process serving it, which is this process and no state of the World: a
      // World's runtime asks it to know that the server on the port is the one it started (world-runtime,
      // MONGODB_PROTOCOL). Where the recording stops: every other section of serverStatus (connections, memory,
      // operation counters, the storage engine) is not answered.
      // source: recording:server-status-pid.json "pid"
      if (name === 'serverStatus') { inService -= 1; return { pid: Long.fromNumber(process.pid), ok: new Double(1) }; }
      try {
        const reply = await answered(database, command);
        // What is not served is answered (the engine's refusal document) and the connection stays; this line, with
        // the command's own words cut short, is all a run has to find the next question from.
        if (typeof reply.errmsg === 'string' && reply.errmsg.endsWith('is not served yet')) console.error(`mongodb not served: ${reply.errmsg} ${said()}`);
        return awaited(name, command, reply, asked) ?? reply;
      } catch (error) {
        // The pack itself failed (its transport, a defect): the sender is told so as a failed command, in the
        // twin's own words and with no code of the server's, and keeps its connection.
        const errmsg = `mongodb twin failed: ${error instanceof Error ? error.message : String(error)}`;
        console.error(`${errmsg} ${said()}`);
        return { ok: new Double(0), errmsg };
      }
      finally {
        const took = performance.now() - started, held = times.get(name) ?? { count: 0, total: 0, longest: 0 };
        times.set(name, { count: held.count + 1, total: held.total + took, longest: Math.max(held.longest, took) });
        inService -= 1;
        countWindow(name, database, took);
      }
    },
  });
  async function answered(database: string, command: mongodb.MongoDocument): Promise<mongodb.MongoDocument> {
    const response = await fetch(new Request('http://mongodb.wire/', { method: 'POST', headers: { 'content-type': 'application/json', [WIRE_HEADER]: wireKey() }, body: JSON.stringify({ database, command: EJSON.serialize(command, { relaxed: false }), ...(options.replicaSet ? { replicaSet: options.replicaSet } : {}) }) }));
    if (!response.ok) throw new Error(`MongoDB private transport answered ${response.status}`);
    return EJSON.deserialize(await response.json(), { relaxed: false }) as mongodb.MongoDocument;
  }
}
