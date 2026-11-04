import { openaiWire } from '@volter/world-core';
export const scenario = openaiWire.scenario('mistral',['chat_completion_v1_chat_completions_post'],(status,message)=>({
  message:message ?? '', type:status===429?'rate_limit_error':'server_error',
}));
