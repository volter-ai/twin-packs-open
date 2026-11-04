import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { inMemoryWorld, usePacks } from '@volter/twin-standard/walk';
import { createTunnelFetch } from '../fetch.ts';

test('simultaneous first registrations have one holder and one collision', async () => {
  usePacks(resolve(import.meta.dir, '../../..'));
  const world = inMemoryWorld('simultaneous-tunnel-registration');
  const root = world.root();
  const fetch = createTunnelFetch({ root });
  const peers: Array<{ send(data: string | Uint8Array): void; close(code?: number): void }> = [];
  try {
    const account = await (await fetch(new Request('http://voltertest.xyz/_twin/accounts', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: 'alice' }),
    }))).json() as { token: string };
    const upgrade = fetch.upgrade!;
    const opens = Array.from({ length: 2 }, () => {
      let done!: (frame: Record<string, unknown>) => void;
      const answer = new Promise<Record<string, unknown>>((resolve) => { done = resolve; });
      let closed: number | undefined;
      const peer = { send(data: string | Uint8Array) { done(JSON.parse(String(data))); },
        close(code?: number) { closed = code; upgrade.close(peer); } };
      peers.push(peer);
      upgrade.open(peer, new Request('http://voltertest.xyz/ws?id=concurrent', { headers: { upgrade: 'websocket' } }));
      return { peer, answer, closed: () => closed };
    });
    for (const connection of opens) upgrade.message(connection.peer, JSON.stringify({
      type: 'register', tunnelId: 'concurrent', secret: account.token, authRequired: false,
    }));
    const replies = await Promise.all(opens.map((connection) => connection.answer));
    expect(replies.filter((reply) => reply.type === 'registered')).toHaveLength(1);
    expect(replies.filter((reply) => reply.type === 'error')).toHaveLength(1);
    expect(opens.map((connection) => connection.closed()).filter(Boolean)).toEqual([4002]);
    expect(replies.find((reply) => reply.type === 'error')?.message).toContain('already in use');
  } finally { for (const peer of peers) fetch.upgrade?.close(peer); world.restore(); }
});
