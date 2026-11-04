// xAI's behaviour (docs/contributing/architecture.md, "Behaviour"): xai is a generative pack, and a turn is a scripted
// scenario's when the World loads one (handlers/xai.json), else the labeled deterministic stub, never a model. The
// scenario is the kernel wire's (openaiWire.scenario), over chat completions and responses alike.
import { openaiWire } from '@volter/world-core';

export const scenario = openaiWire.scenario('xai', ['handle_generic_completion_request', 'handle_generic_model_request'], (status, message) => ({
  code: status === 429 ? 'Too many requests' : 'Internal error', error: message ?? 'The request was refused by a scripted fault.',
}));
