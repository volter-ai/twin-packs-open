// Discord's state machines (architecture, "State"). No object the demand reaches has a lifecycle Discord's API moves:
// a message is made, edited and deleted, a command made, edited and deleted, a channel made, an invite made and spent
// by its uses (counted, not a state).
// The rulings below say which fields the derive might take for state are not.

export const states = {
  // source: https://docs.discord.com/developers/interactions/receiving-and-responding "you must send an initial response within 3 seconds"
  _interaction: { state: { _state: { values: ['pending', 'answered'], initial: 'pending', transitions: [
    { operation: 'create_interaction_response', from: ['pending'], to: 'answered', source: 'https://docs.discord.com/developers/interactions/receiving-and-responding' },
    // source: https://docs.discord.com/developers/topics/opcodes-and-status-codes "Interaction has already been acknowledged"
    { operation: 'create_interaction_response', from: ['answered'], refusal: { status: 400, code: 40060, message: 'Interaction has already been acknowledged.' }, source: 'https://docs.discord.com/developers/topics/opcodes-and-status-codes' },
  ] } } },
  // a channel's, message's and invite's `type` are kinds fixed at creation, never moved
  channel: { notState: ['type'] },
  message: { notState: ['type'] },
  invite: { notState: ['type'] },
  // a command's `type` (chat input, user, message, entry point) is its kind, fixed at creation; an edit takes none
  // source: https://docs.discord.com/developers/interactions/application-commands "Application Command Types"
  command: { notState: ['type'] },
};
