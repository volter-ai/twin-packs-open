// The authorization code's single-use move is part of OpenRouter's documented PKCE flow.
import type { StateField } from '@volter/world-core';

// source: https://openrouter.ai/docs/guides/overview/auth/oauth "The code is single-use and expires after 10 minutes."
const codeStatus: StateField = {
  initial: 'active',
  transitions: [
    { operation: 'exchangeAuthCodeForAPIKey', from: ['active'], to: 'used', source: 'https://openrouter.ai/docs/guides/overview/auth/oauth' },
    { operation: 'exchangeAuthCodeForAPIKey', from: ['used'], refusal: { status: 403, message: 'Invalid code or code_verifier' }, source: 'https://openrouter.ai/docs/guides/overview/auth/oauth' },
  ],
};
export const states = { _auth_code: { state: { status: codeStatus } } };
