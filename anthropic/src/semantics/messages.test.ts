import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAnthropicFetch } from '../fetch.ts';

type Row = Record<string, any>;

/** Task-owned fixture World; seed credentials through the declared door, never insert rows. */
async function fixture(script?: Row) {
  const root = mkdtempSync(join(tmpdir(), 'anthropic-validation-'));
  const scenarioPath = script ? join(root, 'scenario.json') : undefined;
  if (scenarioPath) writeFileSync(scenarioPath, JSON.stringify(script));
  const fetch = createAnthropicFetch({ root, scenarioPath, clock: () => '2026-10-06T12:00:00.000Z' });
  const seed = await fetch(new Request('http://twin.test/_twin/app-credentials', { method: 'POST', body: '{}' }));
  const { key } = await seed.json() as Row;
  return {
    close: () => rmSync(root, { recursive: true, force: true }),
    async message(body: Row) {
      const response = await fetch(new Request('http://twin.test/v1/messages', { method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 256, messages: [{ role: 'user', content: 'Hello' }], ...body }),
      }));
      return { status: response.status, body: await response.json() as Row };
    },
  };
}

test('malformed nested bodies refuse before scenario parsing and unsupported sampling refuses', async () => {
  const world = await fixture({ handlers: [{ on: { userTextIncludes: 'Hello' }, respond: { text: 'scripted' } }] });
  try {
    for (const body of [{ messages: [null] }, { messages: [{ role: 'user', content: {} }] }, { tools: [null] }, { system: [{}] },
      { top_k: 5 }, { top_p: 0.7 }, { temperature: 0.5 }]) {
      const answer = await world.message(body);
      expect(answer.status).toBe(400);
      expect(answer.body.error.type).toBe('invalid_request_error');
    }
  } finally { world.close(); }
});

test('script selection honors forced tools, forbidden tools and single-tool restrictions', async () => {
  const world = await fixture({ handlers: [{ on: { userTextIncludes: 'Hello' },
    respond: { toolUses: [{ name: 'lookup', input: {} }, { name: 'lookup', input: {} }] } }] });
  const tools = ['lookup', 'draft'].map(name => ({ name, input_schema: { type: 'object', properties: {} } }));
  try {
    const forced = await world.message({ tools, tool_choice: { type: 'tool', name: 'draft' } });
    expect(forced.body.content.filter((block: Row) => block.type === 'tool_use').map((block: Row) => block.name)).toEqual(['draft']);
    expect(forced.body.content[0].caller).toEqual({ type: 'direct' });
    const forbidden = await world.message({ tools, tool_choice: { type: 'none' } });
    expect(forbidden.body.content.map((block: Row) => block.type)).toEqual(['text']);
    expect(forbidden.body.content[0].citations).toBeNull();
    const single = await world.message({ tools, tool_choice: { type: 'any', disable_parallel_tool_use: true } });
    expect(single.body.content.filter((block: Row) => block.type === 'tool_use')).toHaveLength(1);
  } finally { world.close(); }
});

test('zero-token warming creates mixed lifetime cache entries and the next turn reads them', async () => {
  const world = await fixture();
  const prompt = {
    system: [
      { type: 'text', text: 'a'.repeat(20000), cache_control: { type: 'ephemeral', ttl: '1h' } },
      { type: 'text', text: 'b'.repeat(4000), cache_control: { type: 'ephemeral', ttl: '5m' } },
    ],
  };
  try {
    const warmed = await world.message({ ...prompt, max_tokens: 0 });
    expect(warmed.status).toBe(200);
    expect(warmed.body.content).toEqual([]);
    expect(warmed.body.stop_reason).toBe('max_tokens');
    expect(warmed.body.usage.output_tokens).toBe(0);
    expect(warmed.body.usage.cache_creation.ephemeral_1h_input_tokens).toBeGreaterThan(0);
    expect(warmed.body.usage.cache_creation.ephemeral_5m_input_tokens).toBeGreaterThan(0);
    expect(warmed.body.usage.cache_creation.ephemeral_1h_input_tokens + warmed.body.usage.cache_creation.ephemeral_5m_input_tokens).toBe(warmed.body.usage.cache_creation_input_tokens);
    const read = await world.message(prompt);
    expect(read.body.usage.cache_creation_input_tokens).toBe(0);
    expect(read.body.usage.cache_read_input_tokens).toBe(warmed.body.usage.cache_creation_input_tokens);
  } finally { world.close(); }
});

