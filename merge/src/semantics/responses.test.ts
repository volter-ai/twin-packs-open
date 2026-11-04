import { expect, test } from 'bun:test';
import { inMemoryWorld } from '@volter/twin-standard/walk';
import { twinResources } from '@volter/world-core/runtime';
import { createMergeFetch } from '../fetch.ts';

test('concurrent priced calls preserve every charge and headers, and invalid input is never charged', async () => {
  const world = inMemoryWorld('gateway-accounting-regression');
  try {
    const root = world.root();
    const fetch = createMergeFetch({ root });
    const create = await fetch(new Request('https://api-gateway.merge.dev/_twin/organizations', { method: 'POST', body: JSON.stringify({ name: 'Accounting' }) }));
    const org = await create.json() as { api_key: string; organization_id: string };
    const request = (body: unknown) => fetch(new Request('https://api-gateway.merge.dev/v1/responses', { method: 'POST', headers: { authorization: `Bearer ${org.api_key}`, 'content-type': 'application/json' }, body: JSON.stringify(body) }));
    const bad = await request({ model: 'zai/glm-5.3-flash' });
    expect(bad.status).toBe(422);
    expect(twinResources('merge', root).find((row) => row.id === org.organization_id)?.spent_usd).toBe(0);
    const replies = await Promise.all(Array.from({ length: 20 }, () => request({ model: 'zai/glm-5.3-flash', input: [{ type: 'message', role: 'user', content: 'Hello ledger' }], include_routing_metadata: true })));
    let expected = 0;
    for (const reply of replies) {
      expect(reply.status).toBe(200);
      expect(reply.headers.get('x-merge-model')).toBe('zai/glm-5.3-flash');
      expect(reply.headers.get('x-merge-vendor')).toBe('zai');
      expect(reply.headers.get('X-Request-ID')).toMatch(/^req_/);
      const result = await reply.json() as { routing: { cost_usd: number; merge_fee_usd: number } };
      expected += result.routing.cost_usd + result.routing.merge_fee_usd;
    }
    expect(twinResources('merge', root).find((row) => row.id === org.organization_id)?.spent_usd).toBeCloseTo(expected, 12);
  } finally { world.restore(); }
});
