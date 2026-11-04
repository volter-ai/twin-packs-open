import type { HandlerContext } from '@volter/world-core';
import { bodyOf, environment, METER, orgId, rowsOf } from './shared.ts';

// source: spec:meters:create "Create a meter."
// source: spec:/components/schemas/MeterCreate/properties/unit "scalar"
export async function meters_create(ctx: HandlerContext): Promise<Response> {
  const body = bodyOf(ctx);
  const meter = await ctx.create('Meter', {
    name: body.name, filter: body.filter, aggregation: body.aggregation, organization_id: orgId(ctx),
    unit: body.unit ?? 'scalar', metadata: body.metadata ?? {}, created_at: ctx.occurredAt,
    ...(body.custom_label === undefined ? {} : { custom_label: body.custom_label }),
    ...(body.custom_multiplier === undefined ? {} : { custom_multiplier: body.custom_multiplier }),
    modified_at: null, archived_at: null, _environment: environment(ctx),
  }, 'meters:create');
  return Response.json(meter, { status: 201 });
}

// source: spec:meters:list "List meters."
export async function meters_list(ctx: HandlerContext): Promise<Response> {
  const meters = rowsOf(ctx, METER).map((meter) => ctx.get('Meter', String(meter.id))!);
  return ctx.list('Meter', meters);
}
