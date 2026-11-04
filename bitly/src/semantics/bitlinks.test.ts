import { expect, test } from 'bun:test';
import { inMemoryWorld } from '@volter/twin-standard/walk';
import { branchEntries } from '@volter/world-core/runtime';
import { createBitlyFetch } from '../fetch.ts';

test('concurrent links, signup ownership, private PATCH fields and credential log privacy', async () => {
  const world = inMemoryWorld('bitly-security'); const root = world.root();
  const serve = createBitlyFetch({ root, clock: () => '2026-01-01T00:00:00Z' });
  const send = (path: string, method = 'GET', body?: unknown, token?: string) => serve(new Request(`https://api-ssl.bitly.com${path}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }));
  try {
    const a = await (await send('/_twin/signup', 'POST', { email: 'a@example.test', password: 'secret-a', login: 'a' })).json() as Record<string,string>;
    const b = await (await send('/_twin/signup', 'POST', { email: 'b@example.test', password: 'secret-b', login: 'b' })).json() as Record<string,string>;
    expect((await send('/_twin/signup', 'POST', { email: 'a@example.test', password: 'wrong' })).status).toBe(400);
    const results = await Promise.all(Array.from({length:20}, async (_, i) => {
      const account = i % 2 ? a : b;
      const answer = await send('/v4/bitlinks', 'POST', { long_url: `https://publisher.test/${i}`, group_guid: account.group_guid, tags: ['archive'] }, account.access_token);
      expect(answer.status).toBe(201);return { account, link: await answer.json() as {id:string} };
    }));
    expect(new Set(results.map(result=>result.link.id)).size).toBe(20);
    const own = results.find(result=>result.account===a)!.link.id;
    expect((await send(`/v4/bitlinks/${own}`, 'GET', undefined, b.access_token)).status).toBe(404);
    for (const body of [{ _account:'b@example.test' },{ _group:b.group_guid },{ tags:7 },{ tags:['archive',7] }]) expect((await send(`/v4/bitlinks/${own}`, 'PATCH', body, a.access_token)).status).toBe(400);
    expect((await send('/v4/bitlinks', 'POST', { long_url:'https://publisher.test/bad', tags:7 }, a.access_token)).status).toBe(400);
    for (const archived of [false,true,true,false,false]) expect((await send(`/v4/bitlinks/${own}`, 'PATCH', { archived }, a.access_token)).status).toBe(200);
    const empty = await (await send('/v4/groups?organization_guid=another', 'GET', undefined, a.access_token)).json() as {groups:unknown[]};
    expect(empty.groups).toEqual([]);
    const first = await (await send(`/v4/groups/${a.group_guid}/bitlinks?size=2&created_before=1767398400&tags=archive`, 'GET', undefined,a.access_token)).json() as {pagination:{next:string}};
    const next = await serve(new Request(first.pagination.next,{headers:{authorization:`Bearer ${a.access_token}`}}));expect(next.status).toBe(200);
    const log = JSON.stringify(branchEntries('bitly',root));expect(log).not.toContain('secret-a');expect(log).not.toContain('secret-b');
  } finally { world.restore(); }
});

test('simultaneous authorization codes stay distinct and single-use without logged secrets', async () => {
  const world=inMemoryWorld('bitly-oauth-security');const root=world.root();const serve=createBitlyFetch({root});
  try {
    const accounts=await Promise.all(['a','b'].map(async login=>{
      const account=await (await serve(new Request('https://api-ssl.bitly.com/_twin/signup',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:`${login}@example.test`,password:`secret-${login}`,login})}))).json() as Record<string,string>;
      const fields=new URLSearchParams({client_id:account.client_id,redirect_uri:account.redirect_uri,state:'safe'});
      const sign=await serve(new Request('https://bitly.com/oauth/authorize',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({...Object.fromEntries(fields),email:account.email,password:`secret-${login}`})}));
      const cookie=sign.headers.get('set-cookie')!.split(';')[0]!;return {...account,login,fields,cookie};
    }));
    const codes=await Promise.all(accounts.map(async account=>{
      const response=await serve(new Request('https://bitly.com/oauth/authorize',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',cookie:account.cookie},body:new URLSearchParams({...Object.fromEntries(account.fields),decision:'allow'})}));
      return new URL(response.headers.get('location')!).searchParams.get('code')!;
    }));expect(new Set(codes).size).toBe(2);
    for (let i=0;i<accounts.length;i++) {
      const account=accounts[i]!;const body={client_id:account.client_id,client_secret:account.client_secret,redirect_uri:account.redirect_uri,code:codes[i]!};
      const exchange=(extra:Record<string,string>={})=>serve(new Request('https://api-ssl.bitly.com/oauth/access_token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',accept:'application/json'},body:new URLSearchParams({...body,...extra})}));
      expect((await exchange({grant_type:'wrong'})).status).toBe(400);
      const outcomes=await Promise.all([exchange(),exchange()]);expect(outcomes.map(r=>r.status).sort()).toEqual([200,400]);
      const answer=await outcomes.find(r=>r.status===200)!.json() as {login:string};expect(answer.login).toBe(account.login);
      const log=JSON.stringify(branchEntries('bitly',root));expect(log).not.toContain(account.client_secret);expect(log).not.toContain(codes[i]!);
    }
  } finally {world.restore();}
});
