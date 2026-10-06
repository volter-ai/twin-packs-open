// The Claude API's state machines (docs/contributing/architecture.md, "What an author writes": states), each move cited;
// the manifest takes each resource's whole.
import type { StateField } from '@volter/world-core';

/** An API key: active when made; Disable is reversible, Delete is permanent (archived). */
// source: https://platform.claude.com/docs/en/manage-claude/authentication "Disable is reversible"
const keyStatus: StateField = {
  initial: 'active',
  transitions: [
    { actor: 'external', from: ['active'], to: 'inactive', source: 'https://platform.claude.com/docs/en/manage-claude/authentication' },
    { actor: 'external', from: ['inactive'], to: 'active', source: 'https://platform.claude.com/docs/en/manage-claude/authentication' },
    { actor: 'external', from: ['active', 'inactive'], to: 'archived', source: 'https://platform.claude.com/docs/en/manage-claude/authentication' },
  ],
};

export const states = {
  _api_key: { state: { status: keyStatus } },
  // an organization's name and a workspace's are set when they are made
  organization: { notState: ['name'] },
  workspace: { notState: ['name'] },
};
