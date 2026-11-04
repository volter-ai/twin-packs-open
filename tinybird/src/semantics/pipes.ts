// The Pipes API and API Endpoints (https://www.tinybird.co/docs/api-reference/pipe-api): list, create from full JSON,
// read one and its datafile, drop, publish a node's Endpoint, a node's analysis, and a published Endpoint queried
// (`GET /v0/pipes/<pipe>.json`).
import type { HandlerContext } from '@volter/world-core';
import {
  answer, chDateTime, createPipe, endpointAnswer, endpointNodeOf, grantedResources, hasScope, logPipeRequest, nodeAnalysis, nowIso, originOf, param,
  parseJsonObject, pipeDatafile, pipeKey, pipeView, readOnlyRejection, readPipe, requestNodes, requestParameters, rowsOfType, snapshot, storedPipe, tbError, write, type TagResource,
  type TinybirdRequest, type Token,
} from './shared.ts';

/** GET /v0/pipes: the Pipes the token may read. */
export async function pipes(ctx: HandlerContext): Promise<Response> {
  return answer(ctx, 'workspace', (req, _query, token) => {
    if (!hasScope(token, 'PIPES:READ')) return tbError(403, 'token does not have the PIPES:READ scope');
    // source: https://www.tinybird.co/docs/api-reference/pipe-api "Get a list of pipes in your account."
    // where the page stops: it does not say a READ token scoped to some Pipes lists only those; the twin lists what the
    // token may read, as the Data Sources list does
    const visible = grantedResources(token, 'PIPES:READ');
    const list = [...snapshot(req).pipes.values()]
      .filter((p) => visible === undefined || visible.has(p.name))
      .map((p) => pipeView(p, originOf(req)));
    return { status: 200, body: { pipes: list } };
  });
}

/** POST /v0/pipes from full JSON, a name and one SQL, or a copy of another Pipe (`from`). */
export async function pipe_create(ctx: HandlerContext): Promise<Response> {
  return answer(ctx, 'workspace', (req, query, token) => {
    // source: https://www.tinybird.co/docs/api-reference/pipe-api "Creates a new Pipe. There are 3 ways to create a Pipe"
    if (!hasScope(token, 'PIPES:CREATE')) return tbError(403, 'token does not have the PIPES:CREATE scope');
    if (req.readOnly) return readOnlyRejection();
    // source: https://www.tinybird.co/docs/api-reference/pipe-api "There are 3 ways to create a Pipe"
    const form = new URLSearchParams(req.body ?? '');
    let json = parseJsonObject(req.body);
    const get = (key: string) => query.get(key) ?? form.get(key);
    const nameAsked = get('name');
    // `from` copies another Pipe only for a create that sends no full JSON: the SDK tags every request from=ts-sdk
    if (!json && get('from')) {
      // source: https://www.tinybird.co/docs/api-reference/pipe-api "Pipes can be also created as copies of other Pipes. Just use the from argument"
      const source = readPipe(get('from')!, req);
      if (!source) return tbError(404, `Pipe '${get('from')}' not found`);
      if (!hasScope(token, 'PIPES:READ', source.name)) return tbError(403, 'token does not have the PIPES:READ scope');
      const endpoint = endpointNodeOf(source);
      json = { name: nameAsked, description: source.description, nodes: source.nodes.map((node) => ({ ...node, type: endpoint?.id === node.id ? 'endpoint' : node.type })) };
    } else if (get('sql') !== null) {
      // source: https://www.tinybird.co/docs/api-reference/pipe-api "you can set your name and first transformation node’s SQL in your POST request"
      json = { name: nameAsked, nodes: [{ sql: get('sql'), type: 'endpoint' }] };
    }
    // Documentation stops at this input rule; the exact refusal wording is not published.
    if (!json) return tbError(400, 'Provide full JSON, SQL, or a source Pipe');
    const name = typeof json.name === 'string' ? json.name : query.get('name') ?? undefined;
    const description = (typeof json.description === 'string' ? json.description : query.get('description')) ?? '';
    if (!name) return tbError(400, "You need to provide a value for 'name'");
    return createPipe(req, query, name, description, requestNodes(req, name, json), json);
  });
}

/** The Pipe as its datafile. */
function datafile(req: TinybirdRequest, token: Token, pipeName: string) {
  const pipe = readPipe(pipeName, req);
  if (!pipe) return tbError(404, `Pipe '${pipeName}' not found`);
  if (!hasScope(token, 'PIPES:READ', pipeName)) return tbError(403, `token does not have the PIPES:READ scope for '${pipeName}'`);
  return { status: 200, body: pipeDatafile(pipe, req), headers: { 'content-type': 'text/plain' } };
}

/** GET /v1/pipes/<pipe>.pipe: the CLI's read of a Pipe's datafile (`tb push --only-changes` compares it). */
export async function pipe_file(ctx: HandlerContext): Promise<Response> {
  return answer(ctx, 'workspace', (req, _query, token) => datafile(req, token, param(ctx, 'pipe')));
}

/** GET /v0/pipes/<pipe>.<format>: a published Endpoint queried. Every request to an Endpoint is a row of
 *  tinybird.pipe_stats_rt, an error included. */
export async function pipe_data(ctx: HandlerContext): Promise<Response> {
  return answer(ctx, 'workspace', async (req, query, token) => {
    const pipeName = param(ctx, 'pipe_name_or_uid');
    const format = param(ctx, 'format').toLowerCase();
    const pipe = readPipe(pipeName, req);
    if (!pipe) return tbError(404, `Pipe '${pipeName}' not found`);
    if (!hasScope(token, 'PIPES:READ', pipeName)) return tbError(403, `token does not have the PIPES:READ scope for '${pipeName}'`);
    const answered = await endpointAnswer(req, pipe, format, query);
    const tags = rowsOfType('tag', req).filter((t) => ((t.resources as TagResource[]) ?? []).some((x) => x.name === pipe.name)).map((t) => String(t.name));
    await logPipeRequest(req, { pipeId: pipe.pipeId, pipeName: pipe.name, method: req.method, params: requestParameters(query), token, response: answered.response, ...(answered.result ? { result: answered.result } : {}), tags });
    return answered.response;
  });
}

/** GET /v0/pipes/<pipe>: the Pipe's metadata. */
export async function pipe(ctx: HandlerContext): Promise<Response> {
  return answer(ctx, 'workspace', (req, _query, token) => {
    const pipeName = param(ctx, 'pipe');
    const found = readPipe(pipeName, req);
    if (!found) return tbError(404, `Pipe '${pipeName}' not found`);
    // source: https://www.tinybird.co/docs/api-reference/pipe-api "Get pipe information. Provided Auth Token must have read access to the Pipe."
    if (!hasScope(token, 'PIPES:READ', pipeName)) return tbError(403, `token does not have the PIPES:READ scope for '${pipeName}'`);
    return { status: 200, body: pipeView(found, originOf(req)) };
  });
}

/** DELETE /v0/pipes/<pipe>. */
export async function pipe_delete(ctx: HandlerContext): Promise<Response> {
  return answer(ctx, 'workspace', async (req, _query, token) => {
    const pipeName = param(ctx, 'pipe_name');
    // source: https://www.tinybird.co/docs/api-reference/pipe-api "Drops a Pipe from your account. Auth token in use must have the DROP:NAME scope."
    // source: https://www.tinybird.co/docs/classic/administration/auth-tokens "PIPES:DROP:pipe_name Allows your Token to delete the specified Pipe."
    if (!hasScope(token, 'PIPES:DROP', pipeName)) return tbError(403, `token does not have the PIPES:DROP scope for '${pipeName}'`);
    if (req.readOnly) return readOnlyRejection();
    if (!readPipe(pipeName, req)) return tbError(404, `Pipe '${pipeName}' not found`);
    await write('pipe', pipeKey(pipeName), { deleted: true }, 'pipe.delete', req);
    return { status: 204, body: null };
  });
}

/** POST /v0/pipes/<pipe>/nodes/<node>/endpoint: a node's Endpoint published, the Pipe's `endpoint` moving as its
 *  machine declares (./states.ts). */
export async function pipe_set_endpoint(ctx: HandlerContext): Promise<Response> {
  return answer(ctx, 'workspace', async (req, _query, token) => {
    const pipeName = param(ctx, 'pipe_name_or_uid');
    const pipe = readPipe(pipeName, req);
    // source: https://www.tinybird.co/docs/api-reference/pipe-api/api-endpoints "404 Pipe not found"
    if (!pipe) return tbError(404, `Pipe '${pipeName}' not found`);
    const nodeRef = param(ctx, 'published_node_uid');
    const node = pipe.nodes.find((n) => n.id === nodeRef || n.name === nodeRef);
    // source: https://www.tinybird.co/docs/api-reference/pipe-api/api-endpoints "permissions to publish a pipe, it needs ADMIN or PIPE:CREATE"
    if (!hasScope(token, 'PIPES:CREATE')) return tbError(403, 'token does not have the PIPES:CREATE scope');
    if (req.readOnly) return readOnlyRejection();
    // source: https://www.tinybird.co/docs/api-reference/pipe-api/api-endpoints "400 Wrong node id"
    if (!node) return tbError(400, `Wrong node id: '${nodeRef}' is no node of pipe '${pipeName}'`);
    if (pipe.nodes.some((n) => n.type === 'materialized')) return tbError(400, `Pipe '${pipeName}' is materialized; a materialized pipe cannot publish an endpoint`);
    // a published Pipe publishing another of its nodes moves its endpoint there (the machine allows it from either state)
    ctx.legal('Pipe', 'endpoint', 'pipe_set_endpoint', endpointNodeOf(pipe)?.id ?? null, undefined, pipe.pipeId);
    const published = { ...pipe, endpointNode: node.id, changedAt: chDateTime(nowIso(req)) };
    await write('pipe', pipeKey(pipeName), storedPipe(published), 'pipe.publish', req);
    return { status: 200, body: pipeView(readPipe(pipeName, req)!, originOf(req)) };
  });
}

/** GET /v0/pipes/<pipe>/nodes/<node>/analysis: the columns the node's output has. */
export async function analyze_pipe_node(ctx: HandlerContext): Promise<Response> {
  return answer(ctx, 'workspace', (req, _query, token) => {
    const pipeName = param(ctx, 'pipe_name');
    const found = readPipe(pipeName, req);
    if (!found) return tbError(404, `Pipe '${pipeName}' not found`);
    const nodeRef = param(ctx, 'node_name');
    return nodeAnalysis(req, found, nodeRef, found.nodes.find((n) => n.id === nodeRef || n.name === nodeRef), token);
  });
}
