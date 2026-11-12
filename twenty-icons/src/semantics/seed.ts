// twenty-icons's default data, copied by `volter world init` into a World as seeds/defaults/twenty-icons.data.ts, where
// the World owns it: the domains the World knows at its start, each at the largest size the vendor holds for it
// (spec/SOURCE.md, Answers). They are the companies Twenty puts in every new workspace
// (packages/twenty-server/src/engine/workspace-manager/standard-objects-prefill-data/utils/prefill-companies.util.ts at
// twentyhq/twenty e79b3365); a World's seed or scenario declares any other through the same door.
import type { SeedCall } from '@volter/world-core';
export const seed: SeedCall[] = [
  {
    method: 'POST',
    path: '/_twin/icons',
    body: { icons: [
      { domain: 'airbnb.com', size: 192 },
      { domain: 'anthropic.com', size: 128 },
      { domain: 'stripe.com', size: 128 },
      { domain: 'figma.com', size: 128 },
      { domain: 'notion.com', size: 128 },
    ] },
  },
];
