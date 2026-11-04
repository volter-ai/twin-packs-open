// ElevenAgents' behaviour (docs/contributing/architecture.md, "Behaviour"): an agent's turn on its conversation socket is a
// scripted scenario's when the World loads one (handlers/elevenlabs.json), else the labeled deterministic stub, never a
// model. The turn is read as the agent's LLM would be asked it, on the kernel's OpenAI wire (its model, its prompt and
// transcript, its last user text, its client tools and the tool results it ends with), so the `on` and `respond` keys are
// the wire's (respond: text, toolCalls). No HTTP operation takes a scripted turn: ./sockets.ts asks for each
// (session.decide). A scripted fault is answered as the conversation's client_error frame.
import { openaiWire } from '@volter/world-core';

// source: https://elevenlabs.io/docs/eleven-agents/api-reference/eleven-agents/websocket.md "client_error"
// Where the documentation stops: the reference names the frame's code, error_name and message and no error names; the
// twin's are the HTTP status's class
export const scenario = openaiWire.scenario('elevenlabs', [], (status, message) => ({
  type: 'client_error',
  error_event: { code: status, error_name: status >= 500 ? 'internal_error' : 'client_error', message: message ?? 'The turn was refused by a scripted fault.' },
}));
