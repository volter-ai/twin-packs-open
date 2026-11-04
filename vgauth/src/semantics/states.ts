import type { StateField } from '@volter/world-core';
// source: recording:managed-account-database-source.txt "plan_status TEXT NOT NULL DEFAULT 'free'"
const planStatus: StateField = {
  initial: 'free',
  transitions: [],
};
// The projection only reaches the initial Free row; paid-plan mutation operations are outside this public dispatch.
// authenticated/backend are response discriminators; admission mirrors Clerk private metadata rather than a ledger move.
export const states = { Account: { state: { 'plan.status': planStatus }, notState: ['authenticated', 'backend', 'spendPolicy.overageEnabled', 'entitlements.generation'] } };
