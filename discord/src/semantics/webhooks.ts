// Incoming webhooks and interaction-token webhooks share Discord's endpoints; their credentials and lifetimes differ.
import type { HandlerContext } from '@volter/world-core';
import { CHANNEL, editInteractionMessage, INTERACTION, interactionMessage, MESSAGE, messageBody, messageView, newMessage, unknown, queryTrue, webhookMessage, webhookOwner } from './shared.ts';

// source: https://docs.discord.com/developers/resources/webhook "Returns a message or 204 No Content depending on the wait query parameter."
export async function execute_webhook(ctx: HandlerContext): Promise<Response> {
  const at = webhookOwner(ctx);
  if (at instanceof Response) return at;
  const { owner: hook, interaction } = at;
  const { body, files } = await messageBody(ctx);
  // source: https://docs.discord.com/developers/interactions/receiving-and-responding "this endpoint will function as Edit Original Interaction Response for backwards compatibility"
  if (interaction && hook._deferred) {
    const original = webhookMessage(ctx, hook, true);
    return original instanceof Response ? original : editInteractionMessage(ctx, hook, original, body, files);
  }
  if (interaction) {
    const made = await interactionMessage(ctx, hook, body, files);
    return made instanceof Response ? made : Response.json(messageView(ctx, made));
  }
  const q = new URL(ctx.call.request.url).searchParams;
  const threadId = q.get('thread_id');
  const channel = ctx.row(CHANNEL, threadId ?? String(hook.channel_id));
  if (!channel || channel.deleted === true || (threadId && channel.parent_id !== hook.channel_id)) return unknown(10003, 'Channel');
  const made = await newMessage(ctx, channel, { webhook: hook, ...(hook.application_id ? { application: String(hook.application_id) } : {}) }, body, files);
  return made instanceof Response ? made : queryTrue(ctx, 'wait') ? Response.json(messageView(ctx, made)) : new Response(null, { status: 204 });
}

// source: https://docs.discord.com/developers/interactions/receiving-and-responding "Edits the initial Interaction response."
export async function update_original_webhook_message(ctx: HandlerContext): Promise<Response> {
  const at = webhookOwner(ctx);
  if (at instanceof Response) return at;
  const m = webhookMessage(ctx, at.owner, at.interaction);
  if (m instanceof Response) return m;
  const { body, files } = await messageBody(ctx);
  return editInteractionMessage(ctx, at.owner, m, body, files);
}

// source: https://docs.discord.com/developers/interactions/receiving-and-responding "Deletes the initial Interaction response. Returns 204 No Content on success."
export async function delete_original_webhook_message(ctx: HandlerContext): Promise<Response> {
  const at = webhookOwner(ctx);
  if (at instanceof Response) return at;
  const m = webhookMessage(ctx, at.owner, at.interaction);
  if (m instanceof Response) return m;
  await ctx.remove(MESSAGE, String(m.id), 'message.delete');
  await ctx.write(INTERACTION, String(at.owner.id), { _deferred: false }, 'interaction.complete');
  return new Response(null, { status: 204 });
}
