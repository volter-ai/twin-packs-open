// An OpenAI chat completion as a custom LLM answers ElevenLabs: Server-Sent Events of `data: {chunk}` lines ending with
// `data: [DONE]` (what ElevenLabs asks for). Read into the turn it says: its text and the tools
// it calls. Pure computation over the answer's text.

type Row = Record<string, unknown>;
export type ChatTurn = { text: string; toolCalls: Array<{ id?: string; name: string; arguments: Row }> };

const obj = (v: unknown): Row => (v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {});
const parse = (text: string): unknown => { try { return JSON.parse(text); } catch { return undefined; } };
const args = (text: string): Row => obj(parse(text || '{}'));

/** The turn a completion says, or undefined when it says nothing (no text and no tool call) or is no completion. */
export function readChatCompletion(body: string): ChatTurn | undefined {
  const trimmed = body.trim();
  let text = '';
  const calls: Array<{ id?: string; name: string; args: string }> = [];
    // a stream: each chunk's delta, the tool calls' parts joined by their index
    for (const line of trimmed.split('\n')) {
      const data = line.startsWith('data:') ? line.slice(5).trim() : '';
      if (!data || data === '[DONE]') continue;
      const delta = obj(obj((obj(parse(data)).choices as unknown[] | undefined)?.[0]).delta);
      if (typeof delta.content === 'string') text += delta.content;
      for (const c of Array.isArray(delta.tool_calls) ? delta.tool_calls : []) {
        const part = obj(c);
        const i = typeof part.index === 'number' ? part.index : calls.length;
        const f = obj(part.function);
        calls[i] ??= { name: '', args: '' };
        if (typeof part.id === 'string') calls[i]!.id = part.id;
        if (typeof f.name === 'string') calls[i]!.name += f.name;
        if (typeof f.arguments === 'string') calls[i]!.args += f.arguments;
      }
    }
  const toolCalls = calls.filter((c) => c && c.name).map((c) => ({ ...(c.id ? { id: c.id } : {}), name: c.name, arguments: args(c.args) }));
  return text || toolCalls.length ? { text, toolCalls } : undefined;
}
