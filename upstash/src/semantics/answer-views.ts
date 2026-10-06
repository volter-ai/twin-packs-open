// Upstash's answers as their clients read them (architecture, "Pack layout": answer-views.ts).
//
// `decoded`: a REST answer sent with `Upstash-Encoding: base64`, as @upstash/redis 1.38.2 decodes it (its responseEncoding
// defaults to base64): a single command's `{ result, error }`, a pipeline's or a transaction's array of them, each result
// decoded so: a string is base64 of its UTF-8 text, except the status reply OK; a number stays; an array's strings are
// each decoded and its nested arrays decoded again; any other object is null.
// source: https://raw.githubusercontent.com/upstash/redis-js/%40upstash/redis%401.38.2/packages/redis/pkg/http.ts ": base64decode(raw);"
// source: https://raw.githubusercontent.com/upstash/redis-js/%40upstash/redis%401.38.2/packages/redis/pkg/http.ts "return body.map(({ result, error }) => ({"
//
// `steps`: what QStash delivered to a Workflow route (the `/_twin/deliveries` door's answer), each delivery with `steps`,
// its body as @upstash/workflow 1.3.0's serve() reads it: a run's first call carries the initial payload as it is; each
// later call carries the run's steps so far, a JSON array whose first entry is the initial payload and each next a step
// (`callType: "step"`), every body base64 of its JSON (processRawSteps). Each step's `body` is that JSON parsed (its text
// where it is not JSON).
// source: https://raw.githubusercontent.com/upstash/workflow-js/v1.3.0/src/workflow-parser.ts "const [encodedInitialPayload, ...encodedSteps] = rawSteps;"

type Row = Record<string, unknown>;

const base64decode = (b64: string): string => {
  const bytes = Buffer.from(b64, 'base64');
  // Buffer accepts arbitrary string input; the client keeps text whose encoding is not canonical base64.
  if (bytes.toString('base64').replace(/=+$/, '') !== b64.replace(/=+$/, '')) return b64;
  return new TextDecoder().decode(bytes);
};

function decode(raw: unknown): unknown {
  if (raw === undefined) return raw;
  if (typeof raw === 'number') return raw;
  if (typeof raw === 'string') return raw === 'OK' ? 'OK' : base64decode(raw);
  if (Array.isArray(raw)) return raw.map((v) => (typeof v === 'string' ? base64decode(v) : Array.isArray(v) ? v.map((e) => decode(e)) : v));
  return typeof raw === 'object' ? null : undefined;
}

const parsed = (text: string): unknown => {
  try { return JSON.parse(text); } catch { return text; }
};

function stepsOf(body: unknown): Row[] {
  const text = typeof body === 'string' ? body : '';
  const raw = parsed(text);
  const encoded = Array.isArray(raw) && raw.length > 0 && raw.every((s) => s && typeof s === 'object' && typeof (s as Row).body === 'string');
  if (!encoded) return [{ body: raw }];
  const [first, ...rest] = raw as Row[];
  return [
    { ...first, body: parsed(base64decode(String(first!.body))) },
    ...rest.filter((s) => s.callType === 'step').map((s) => ({ ...s, body: parsed(base64decode(String(s.body))) })),
  ];
}

export const answerViews: Record<string, (body: unknown) => unknown> = {
  decoded: (body) => {
    if (Array.isArray(body)) return body.map((item) => ({ result: decode((item as Row | null)?.result), error: (item as Row | null)?.error }));
    const b = (body ?? {}) as Row;
    return { result: decode(b.result), error: b.error };
  },
  steps: (body) => {
    const b = (body ?? {}) as Row;
    const deliveries = Array.isArray(b.deliveries) ? (b.deliveries as Row[]) : [];
    return { ...b, deliveries: deliveries.map((d) => ({ ...d, steps: stepsOf(d.body) })) };
  },
};
