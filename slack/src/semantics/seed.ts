// Fresh local defaults reach the workspace through Slack's existing signup screen, exactly as the customer life does.
// This synthetic owner is the screen's client session, never a real Slack credential. The bot's credential door
// installs an application in this workspace; it does not create the workspace itself.
import type { SeedCall } from '@volter/world-core';

export const seed: SeedCall[] = [
  {
    method: 'POST', path: '/get-started',
    headers: { authorization: 'Bearer xoxp-UWORLDOWNER', 'content-type': 'application/x-www-form-urlencoded' },
    body: { email: 'owner@world.test', name: 'World Owner' },
  },
];
