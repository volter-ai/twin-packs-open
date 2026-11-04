import { openaiWire, type HandlerContext } from '@volter/world-core';
// source: spec:chat_completion_v1_chat_completions_post "Chat Completion"
export async function chat_completion_v1_chat_completions_post(ctx: HandlerContext): Promise<Response> {
  const body = ctx.body as Record<string,unknown>;
  // source: spec:/components/schemas/ChatCompletionRequest/required "model"
  // source: spec:/components/schemas/ChatCompletionRequest/required "messages"
  if (typeof body.model!=='string' || !Array.isArray(body.messages) || !body.messages.length)
    return Response.json({message:'model and messages are required',type:'invalid_request_error'},{status:422});
  // source: spec:/components/schemas/ChatCompletionRequest/properties/model "ID of the model to use."
  // Where documentation stops: account model access is scenario judgment. These demanded catalog aliases
  // are synthetic available models; other names have no configured model in this World.
  if (!['mistral-small-latest','mistral-medium-latest','mistral-large-latest'].includes(body.model))
    return Response.json({message:'Model is not available',type:'invalid_request_error'},{status:400});
  const messages = body.messages as Record<string,unknown>[];
  // source: spec:/components/schemas/ChatCompletionRequest/properties/tool_choice "any"
  const requested = body.tool_choice==='any' ? {...body,tool_choice:'required'} : body;
  const turn = openaiWire.scenarioTurn(ctx.scenario) ?? openaiWire.chatStubTurn(requested,'Mistral API twin');
  // source: spec:/components/schemas/ChatCompletionRequest/properties/parallel_tool_calls "Whether to enable parallel function calling during tool use"
  if (body.parallel_tool_calls===false && turn.toolCalls) turn.toolCalls=turn.toolCalls.slice(0,1);
  // source: spec:/components/schemas/ChatCompletionRequest/properties/stop "Stop generation if this token is detected."
  const stops = typeof body.stop==='string' ? [body.stop] : Array.isArray(body.stop) ? body.stop.filter((x):x is string=>typeof x==='string') : [];
  if (typeof turn.text==='string') {
    const positions=stops.filter(Boolean).map(x=>turn.text!.indexOf(x)).filter(x=>x>=0);
    if (positions.length) turn.text=turn.text.slice(0,Math.min(...positions));
  }
  const id = await ctx.issue('_completion');
  const shape: openaiWire.ChatShape = {
    id, model:String(body.model), created:Math.floor(Date.parse(ctx.occurredAt)/1000),
    messages, turn,
    // Where documentation stops: these are private synthetic IDs, not identifiers returned by inference.
    callId:i=>ctx.crypto.digest('sha256',`${id}:call:${i}`,'hex').slice(0,9),
    maxTokens:typeof body.max_tokens==='number'?body.max_tokens:undefined,
  };
  // source: spec:/components/schemas/ChatCompletionRequest/properties/n "input tokens are only billed once"
  const n = typeof body.n==='number' ? Math.max(1,Math.floor(body.n)) : 1;
  // source: spec:/components/schemas/ChatCompletionRequest/properties/stream "stream terminated by a data: [DONE] message"
  if (body.stream===true) {
    const stream = openaiWire.chatCompletionSSE(shape).split('\n\n').map(frame => {
      if (!frame.startsWith('data: {')) return frame;
      const chunk = JSON.parse(frame.slice(6));
      chunk.choices = Array.from({length:n},(_,index)=>({...chunk.choices[0],index}));
      if (chunk.usage) {
        chunk.usage.completion_tokens *= n;
        chunk.usage.completion_tokens_details.reasoning_tokens *= n;
        chunk.usage.total_tokens = chunk.usage.prompt_tokens + chunk.usage.completion_tokens;
      }
      return `data: ${JSON.stringify(chunk)}`;
    }).join('\n\n');
    return new Response(stream,{headers:{'content-type':'text/event-stream'}});
  }
  const answer = openaiWire.chatCompletion(shape);
  const choice=(answer.choices as Record<string,unknown>[])[0];
  answer.choices=Array.from({length:n},(_,index)=>({...choice,index}));
  const usage=answer.usage as Record<string,number>;
  usage.completion_tokens*=n;usage.total_tokens=usage.prompt_tokens+usage.completion_tokens;
  (answer.usage as {completion_tokens_details:{reasoning_tokens:number}}).completion_tokens_details.reasoning_tokens*=n;
  return Response.json(answer);
}
