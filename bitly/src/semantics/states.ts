import type { StateField } from '@volter/world-core';

export const states: Record<string, { state?: Record<string, StateField>; notState?: string[] }> = {
  // source: spec:/components/schemas/Group "is_active"
  // Group membership/activity and role are account setup observations; no served operation changes them.
  Group: { notState: ['is_active', 'role'] },
  BitlinkBody: {
    // source: spec:/components/schemas/BitlinkUpdate "is_deleted"
    // No served deletion operation; this boolean is an observed deletion marker, not an API-controlled machine.
    notState: ['is_deleted'],
    state: {
      // source: spec:/components/schemas/BitlinkUpdateBody "archived"
      archived: { unchanged: 'allow', initial: false, transitions: [
        { operation: 'updateBitlink', from: ['false'], to: 'true', source: 'spec:/components/schemas/BitlinkUpdateBody "archived"' },
        { operation: 'updateBitlink', from: ['true'], to: 'false', source: 'spec:/components/schemas/BitlinkUpdateBody "archived"' },
      ] },
    },
  },
};
