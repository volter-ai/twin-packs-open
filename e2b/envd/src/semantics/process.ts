// A process started in a sandbox (envd's `Process.Start`, a server stream over the Connect protocol): the request is
// one enveloped JSON message (a flags byte, a 4-byte length, the message); the answer is a stream of enveloped
// events — the process's start (its pid), its output as it comes, its end — closed by the end-of-stream envelope.
// The process runs in the sandbox's machine on the World's pool (ctx.machines.exec).
import { isMachineCapabilityGap, type HandlerContext } from '@volter/world-core';
import { obj, liveSandbox, lifecycle, processUnavailable } from './shared.ts';

// source: https://connectrpc.com/docs/protocol "Streaming-Response"
const envelope = (flags: number, message: unknown): Uint8Array => {
  const body = new TextEncoder().encode(JSON.stringify(message));
  const out = new Uint8Array(5 + body.byteLength);
  out[0] = flags;
  new DataView(out.buffer).setUint32(1, body.byteLength);
  out.set(body, 5);
  return out;
};
const b64 = (s: string): string => Buffer.from(s).toString('base64');
/** A Connect error: before any message, an HTTP error with the Connect error body. */
const connectError = (status: number, code: string, message: string): Response => Response.json({ code, message }, { status });

// source: spec:Process.Start "Start"
export async function Process_Start(ctx: HandlerContext): Promise<Response> {
  const id = String(ctx.call.params.sandboxID ?? '');
  const sb = await liveSandbox(ctx, lifecycle);
  if (sb instanceof Response) return sb;
  const raw = new Uint8Array(await ctx.call.request.clone().arrayBuffer());
  if (raw.byteLength < 5 || raw.byteLength !== 5 + new DataView(raw.buffer, raw.byteOffset).getUint32(1)) return connectError(400, 'invalid_argument', 'the request is not one enveloped message');
  let request: Record<string, unknown>;
  try { request = obj(JSON.parse(new TextDecoder().decode(raw.subarray(5)))); } catch { return connectError(400, 'invalid_argument', 'the message is not JSON'); }
  const p = obj(request.process);
  if (typeof p.cmd !== 'string' || !p.cmd) return connectError(400, 'invalid_argument', 'process.cmd is required');
  const args = [p.cmd, ...(Array.isArray(p.args) ? p.args.map(String) : [])];
  let proc;
  try {
    proc = await ctx.machines.exec(id, { args, env: Object.fromEntries(Object.entries(obj(p.envs)).map(([k, v]) => [k, String(v)])), ...(typeof p.cwd === 'string' ? { cwd: p.cwd } : {}) });
  } catch (error) {
    // Architecture, "Other wires: … machines": an unserved command is the twin's declared gap.
    if (isMachineCapabilityGap(error)) return ctx.gap();
    return processUnavailable(id);
  }

  // source: spec:Process.Start "Start"
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    cancel() { cancelled = true; },
    async start(controller) {
      controller.enqueue(envelope(0, { event: { start: { pid: proc.pid } } }));
      for await (const e of proc.events) {
        if (cancelled) return;
        if ('stdout' in e && e.stdout !== undefined) controller.enqueue(envelope(0, { event: { data: { stdout: b64(e.stdout) } } }));
        else if ('stderr' in e && e.stderr !== undefined) controller.enqueue(envelope(0, { event: { data: { stderr: b64(e.stderr) } } }));
        else if ('exit' in e) controller.enqueue(envelope(0, { event: { end: { exitCode: e.exit, exited: true, status: `exit status ${e.exit}` } } }));
      }
      if (cancelled) return;
      controller.enqueue(envelope(2, {}));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'application/connect+json' } });
}
