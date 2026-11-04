// A check-in records progress and its final outcome; classification fields are not lifecycle machines.
export const states = {
  // source: spec:listProjectEvents "Return a list of events bound to a project."
  // Event type classifies the received payload; the reads do not move it between types.
  event: { notState: ['type'] },
  // source: spec:getOrganizationIssue "Return details on an individual issue"
  // The issue read exposes classifications and account-relative flags; no served operation changes them.
  issue: { notState: ['level', 'type', 'status', 'substatus', 'priority', 'isPublic', 'hasSeen', 'isBookmarked', 'isSubscribed', 'isUnhandled'] },
  // source: spec:listOrganizationMonitors "Retrieve Monitors for an Organization"
  // Monitor enablement is account configuration; received check-ins do not move that setting.
  monitor: { notState: ['status'] },
  check_in: { state: { status: { initial: 'in_progress', transitions: [
    // source: https://raw.githubusercontent.com/getsentry/sentry-docs/3ec4e139711af82b38a3c2c17261f5f5cdb66dfc/develop-docs/sdk/foundations/envelopes/envelope-items.mdx "check-in payload encoded as JSON"
    { actor: 'vendor' as const, from: ['in_progress'], to: 'ok', source: 'https://docs.sentry.io/platforms/javascript/guides/node/crons/ "ok"' },
    { actor: 'vendor' as const, from: ['in_progress'], to: 'error', source: 'https://docs.sentry.io/platforms/javascript/guides/node/crons/ "error"' },
  ] } } },
};
