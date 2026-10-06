// source: spec:listModels "Lists the currently available models"
import type { HandlerContext } from '@volter/world-core';
import { epoch, findModel, live, OPENAI_MODELS, timeline } from './shared.ts';
export async function listModels(ctx: HandlerContext): Promise<Response> {
  const gone = timeline(ctx); if (gone) return gone;
  return ctx.reply({ object: 'list', data: OPENAI_MODELS.filter(m => live(m.id, epoch(ctx))) });
}
// source: spec:retrieveModel "Retrieves a model instance"
export async function retrieveModel(ctx: HandlerContext): Promise<Response> {
  const gone = timeline(ctx); if (gone) return gone;
  const id = String(ctx.id), model = live(id, epoch(ctx)) ? findModel(id) : undefined;
  return model ? ctx.reply(model) : ctx.notFound('Model', id);
}
