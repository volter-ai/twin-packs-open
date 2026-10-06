import { openaiWire } from '@volter/world-core';
export const scenario = openaiWire.scenario('openai', ['codex.responses'], (status, message) => ({ error: { code: status === 429 ? 'rate_limit_exceeded' : 'server_error', message: message ?? 'Scripted Codex fault.', type: 'invalid_request_error' } }));
