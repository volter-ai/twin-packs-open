import type { HandlerContext } from '@volter/world-core';

// An exchange rate is what two vendors must agree on, so it is a World fact (twin-world ADR 0036 §3): the World's
// `exchange-rates` fact for the base currency, `{ <currency>: <rate> }`, as it stands at the request's World time (a
// scenario moves it with a fact entry), served in currencyapi's own shape.
// source: spec:getLatest "Returns the latest exchange rates for a given base currency"
export async function getLatest(ctx: HandlerContext): Promise<Response> {
  const url = new URL(ctx.call.request.url);
  // source: spec:/components/parameters/BaseCurrency/description "The base currency that all returned values are relative to."
  // the base defaults to USD (spec:getLatest: "for a given base currency (default USD)")
  const base = (url.searchParams.get('base_currency') ?? 'USD').toUpperCase();
  // source: spec:/components/parameters/Currencies/description "Comma-separated list of currency codes to include"
  const asked = [...url.searchParams.getAll('currencies').flatMap((v) => v.split(',')), ...url.searchParams.getAll('currencies[]')].map((c) => c.trim().toUpperCase()).filter(Boolean);
  const rates = (await ctx.fact('exchange-rates', base) ?? {}) as Record<string, unknown>;
  // source: spec:/components/parameters/Currencies/description "By default all supported currencies are returned."
  // Where the documentation stops and the World decides: the supported currencies are those the World holds a rate for,
  // since a rate the World does not hold is no fact two vendors could agree on.
  const data: Record<string, { code: string; value: number }> = {};
  for (const [code, value] of Object.entries(rates)) if (typeof value === 'number' && (!asked.length || asked.includes(code))) data[code] = { code, value };
  // source: spec:/paths/~1v3~1latest/get/responses/200/content/application~1json/example "last_updated_at"
  return Response.json({ meta: { last_updated_at: new Date(Date.parse(ctx.occurredAt)).toISOString().replace(/\.\d{3}Z$/, 'Z') }, data });
}
