// `POST /v0/sql_tables`: the tables a query reads (the CLI resolves datafile dependencies with it).
import type { HandlerContext } from '@volter/world-core';
import { answer, hasScope, parseForm, parseSql, refusingQueries, renderTemplate, tbError, usedTables, type TinybirdResponse } from './shared.ts';

export async function _sql_get_used_tables_remote(ctx: HandlerContext): Promise<Response> {
  return answer(ctx, 'workspace', (req, query, token) => {
    if (!hasScope(token, 'PIPES:CREATE') && !hasScope(token, 'DATASOURCES:READ')) return tbError(403, 'token does not have the PIPES:CREATE scope');
    const form = parseForm(req.body);
    const q = form.q ?? query.get('q') ?? undefined;
    if (!q) return tbError(400, "You need to provide a value for 'q'");
    const raising = (form.raising ?? query.get('raising')) === 'true';
    return refusingQueries<TinybirdResponse>((e) => (raising ? tbError(400, e.message) : { status: 200, body: { tables: [] } }), () => {
      const sql = q.trim().startsWith('%') ? renderTemplate(q, {}, { probe: true }) : q;
      const tables = usedTables(parseSql(sql)).map((t) => (t.includes('.') ? [t.slice(0, t.indexOf('.')), t.slice(t.indexOf('.') + 1)] : ['', t]));
      return { status: 200, body: { tables } };
    });
  });
}
