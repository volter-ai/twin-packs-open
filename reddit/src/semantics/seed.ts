// Reddit's default data, as data (twin-world's architecture, "Pack layout"): calls to the pack's own doors, which
// `volter-world init` copies into the World beside a runner that makes them. Volter's account, u/volter, and its
// community r/volter, which Volter moderates and the launch is posted to; and Aaron's account, u/FamouslyDefault, which
// the Model Editor launch posts from (volter-ai/social media/gtm/channels.yaml reddit-aaron), each signed in on
// reddit.com with its password, the World's own. A seed call carries no token, so the community is made through the
// door standing in for reddit.com's Create a community page; a life makes its own with POST /api/site_admin.
import type { SeedCall } from '@volter/world-core';

export const seed: SeedCall[] = [
  { method: 'POST', path: '/_twin/accounts', body: { username: 'volter', email: 'social@volter.ai', password: 'volter-world-reddit', created: '2024-03-04T17:00:00Z' } },
  { method: 'POST', path: '/_twin/accounts', body: { username: 'FamouslyDefault', email: 'aaron@world.test', password: 'stoneguard-bridge-1005' } },
  {
    method: 'POST', path: '/_twin/subreddits',
    body: {
      name: 'volter', title: 'Volter', owner: 'volter', type: 'public', link_type: 'any', created: '2024-03-04T17:05:00Z',
      public_description: "Volter's community: the Model Editor and the rest of Volter's tools, from the people who build them.",
    },
  },
];
