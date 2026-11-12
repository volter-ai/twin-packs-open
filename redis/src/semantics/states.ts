// source: https://redis.io/docs/latest/commands/type/ "Returns the string representation of the type of the value stored at key."
// notState: key kind is a type checked by each command, TTL is a clock deadline. Neither is a state machine.
// Connection database, protocol, transaction and subscriptions live on the stream connection, never a stored resource.
export const states = {};
export const notState = { key: 'kind is the Redis value type; expiry is a deadline, not a state move', member: 'membership is made/removed by collection commands', script: 'a cached source keyed by its SHA-1, not a state machine' };
