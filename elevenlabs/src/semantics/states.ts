// elevenlabs's state machines and state rulings, each transition cited (architecture, "State").
// A voice is added whole and an agent made whole. A conversation is stored in-progress when it starts, and is done when
// the client hangs up (./sockets.ts close): the vendor's analysis (processing) runs no model in the twin, so the
// conversation is done at once. A conversation whose agent's custom LLM fails a turn after its retries fails.
import type { StateField } from '@volter/world-core';

const conversationStatus: StateField = {
  initial: 'in-progress',
  transitions: [
    { actor: 'vendor', from: ['in-progress'], to: 'done', source: 'spec:/components/schemas/GetConversationResponseModel "done"' },
    // an agent whose custom LLM fails every attempt of a turn (./sockets.ts failed)
    { actor: 'vendor', from: ['in-progress'], to: 'failed', source: 'https://elevenlabs.io/docs/eleven-agents/customization/llm/llm-cascading' },
  ],
};

export const states = {
  conversation: { state: { status: conversationStatus } },
};
