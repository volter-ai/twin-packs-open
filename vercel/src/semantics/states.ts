// Vercel's state machines (docs/contributing/architecture.md, "What an author writes": states), each move cited, and its
// rulings of what is not state; the manifest takes each resource's whole.
import type { StateField } from '@volter/world-core';

const VERIFY = 'spec:verifyProjectDomain "Attempts to verify a project domain with `verified = false` by checking the correctness of the project domain\'s `verification` challenge."';

/** A project domain's `verified`: unverified when it is added only if another Vercel account holds its apex, verified
 *  once its `verification` challenge holds (./domains.ts). */
const verified: StateField = {
  initial: false,
  transitions: [
    { operation: 'verifyProjectDomain', from: ['false'], to: 'true', source: VERIFY },
    { operation: 'verifyProjectDomain', from: ['true'], source: VERIFY },
    // Where the reference stops: this is its documented 400 class; the refusal's words are not specified.
    { operation: 'verifyProjectDomain', from: ['false'], refusal: { status: 400, code: 'missing_txt_record', message: 'The domain verification challenge is not satisfied.' }, source: VERIFY },
  ],
};

/** A team domain's `zone`: whether Vercel's DNS serves it, set by the domain's update (patchDomain `op: update`, `zone`).
 *  Its move back to false (`zone: false`) is no application's (Dub's configureVercelNameservers sends `zone: true`
 *  alone): the manifest names it a variant, answered as the gap, and it is not a move of this machine. */
const zone: StateField = {
  initial: false,
  transitions: [
    { operation: 'patchDomain', from: ['false', 'true'], to: 'true', source: 'spec:patchDomain "Update or move apex domain."' },
  ],
};

export const states = {
  project_domain: { state: { verified }, notState: ['redirect', 'redirectStatusCode', 'gitBranch', 'customEnvironmentId'] },
  domain: { state: { zone }, notState: ['serviceType', 'verified', 'renew'] },
};
