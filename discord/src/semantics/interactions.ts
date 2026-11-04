// HTTP replies to Gateway interactions. Other interaction flows (HTTP PING, modals and Activities) are the gap.
import type { HandlerContext } from '@volter/world-core';
import { editInteractionMessage, EPHEMERAL, gap, INTERACTION, interactionAt, interactionMessage, invalidForm, MESSAGE, messageBody, messageView, obj, queryTrue, webhookMessage } from './shared.ts';

// source: https://docs.discord.com/developers/interactions/receiving-and-responding "Returns 204 unless with_response is set to true which returns 200"
export async function create_interaction_response(ctx: HandlerContext): Promise<Response> {
  const i = interactionAt(ctx, true);
  if (i instanceof Response) return i;
  const refusal = ctx.legal(INTERACTION, '_state', 'create_interaction_response', i._state, 'answered', String(i.id));
  if (refusal) return ctx.refuse(refusal);
  const { body, files } = await messageBody(ctx);
  const type = Number(body.type);
  const data = obj(body.data);
  const incoming = Number(ctx.own(i).type);
  // source: https://docs.discord.com/developers/interactions/receiving-and-responding "Only valid for MODAL_SUBMIT and component-based interactions."
  if (![4, 5, 6, 7, 8].includes(type)) return gap();
  if (([6, 7].includes(type) && incoming !== 3) || (type === 8 && incoming !== 4)) return invalidForm({ type: { code: 'BASE_TYPE_CHOICES', message: 'Invalid interaction response type.' } });
  // source: https://docs.discord.com/developers/interactions/receiving-and-responding "the only valid message flag you may use is EPHEMERAL"
  // Where the documentation stops: the page states the rule, not its refusal; the twin answers in the form-body error (50035)
  if (type === 5 && (Number(data.flags ?? 0) & ~EPHEMERAL) !== 0) return invalidForm({ 'data.flags': { code: 'BASE_TYPE_CHOICES', message: 'Only EPHEMERAL is allowed when deferring.' } });
  // source: https://docs.discord.com/developers/interactions/receiving-and-responding "autocomplete choices (max of 25 choices)"
  if (type === 8 && (!Array.isArray(data.choices) || data.choices.length > 25)) return invalidForm({ 'data.choices': { code: 'BASE_TYPE_MAX_LENGTH', message: 'Must provide at most 25 choices.' } });
  let m;
  if (type === 4 || type === 5) {
    const made = await interactionMessage(ctx, i, data, files, type === 5, true);
    if (made instanceof Response) return made;
    m = made;
  } else if (type === 6 || type === 7) {
    const source = webhookMessage(ctx, { ...i, _original: i._source_message }, true);
    if (source instanceof Response) return source;
    if (type === 7) {
      const answer = await editInteractionMessage(ctx, i, source, data, files);
      if (answer.status >= 400) return answer;
      m = ctx.row(MESSAGE, String(source.id))!;
    } else m = source;
  }
  await ctx.write(INTERACTION, String(i.id), { _state: 'answered', _deferred: type === 5, ...(m ? { _original: m.id } : {}) }, 'create_interaction_response');
  if (!queryTrue(ctx, 'with_response')) return new Response(null, { status: 204 });
  return Response.json({
    interaction: { id: i.id, type: incoming, ...(m ? { response_message_id: m.id, response_message_loading: type === 5, response_message_ephemeral: (Number(m.flags) & 64) !== 0 } : {}) },
    // source: https://docs.discord.com/developers/interactions/receiving-and-responding "Only present if type is either CHANNEL_MESSAGE_WITH_SOURCE or UPDATE_MESSAGE"
    // Where the documentation stops: the page shows no answer to a defer, so the twin answers its callback object alone
    ...((type === 4 || type === 7) && m ? { resource: { type, message: messageView(ctx, m) } } : {}),
  });
}
