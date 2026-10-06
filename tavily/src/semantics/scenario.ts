// The shared World scenario supplies search judgment and status faults for compute-only operations.
import type { PackScenario } from '@volter/world-core';
import { keyOf, type Row } from './shared.ts';

type Asked = { operation: string; query: unknown };
export const scenario: PackScenario<Asked> = {
  operations: ['search', 'extract'],
  request: (ctx) => keyOf(ctx).row ? { operation: ctx.call.operation.id, query: (ctx.body as Row)?.query } : undefined,
  adapter: {
    vendor: 'tavily',
    features: (r) => ({ operation: r.operation, query: String(r.query ?? '') }),
    matchers: { operationEquals: (r, c) => r.operation === c, queryEquals: (r, c) => r.query === c },
    validateOn: (on) => (on.operationEquals !== undefined && !['search', 'extract'].includes(String(on.operationEquals))) || (on.queryEquals !== undefined && typeof on.queryEquals !== 'string') ? invalidMatcher() : null,
    // Judgment supplies parameters/answer, never a successful stored mutation or a complete fabricated vendor response.
validateRespond: (respond, h) => {
      if (h.on.operationEquals !== 'search' || !respond || typeof respond !== 'object' || Array.isArray(respond) || Object.keys(respond).some((k) => !['parameters', 'answer'].includes(k))) return invalidJudgment();
      const r = respond as Row;
      const p = r.parameters as Row | undefined;
      if ((r.answer !== undefined && typeof r.answer !== 'string') || (p !== undefined && (!p || typeof p !== 'object' || Array.isArray(p) || Object.keys(p).some((k) => !['topic', 'search_depth'].includes(k)) || (p.topic !== undefined && !['general', 'news', 'finance'].includes(String(p.topic))) || (p.search_depth !== undefined && !['basic', 'advanced', 'fast', 'ultra-fast'].includes(String(p.search_depth)))))) return invalidJudgment();
      return null;
    },
    // source: spec:/components/schemas/ApiError "error"
    renderFault: (fault) => ({ body: { detail: { error: fault.message ?? 'Internal Server Error' } } }),
  },
};

// A malformed World script is a configuration error, outside the published API.
function invalidJudgment(): string {
  return "Only search judgment {parameters?: {topic?, search_depth?}, answer?: string} is scripted; response-size options remain explicit";
}

function invalidMatcher(): string {
  return "operationEquals names search or extract; queryEquals is a string";
}
