// The key a request is made with (spec: getCurrentKey; docs/api_reference/limits, "Checking your limits"): what an
// application reads to check a key is good and what it may still spend. The twin charges nothing (a completion's cost is
// 0), so a key's usage is 0 and it has no credit limit unless one was set on it.
import type { HandlerContext } from '@volter/world-core';
import { keyOf, orError } from './shared.ts';

// source: spec:getCurrentKey "Get information on the API key associated with the current authentication session"
// source: https://openrouter.ai/docs/api_reference/limits "To check the rate limit or credits left on an API key, make a GET request to"
export async function getCurrentKey(ctx: HandlerContext): Promise<Response> {
  const key = keyOf(ctx);
  // the manifest's auth refuses a key the World never issued before this runs; a key disabled since is refused the same
  // source: spec:getCurrentKey "Unauthorized - Authentication required or invalid credentials"
  if (!key) return orError(401, 'User not found.');
  return Response.json({
    data: {
      // source: spec:getCurrentKey "Human-readable label for the API key"
      label: key.masked,
      limit: null, limit_remaining: null, limit_reset: null, include_byok_in_limit: false,
      usage: 0, usage_daily: 0, usage_weekly: 0, usage_monthly: 0,
      byok_usage: 0, byok_usage_daily: 0, byok_usage_weekly: 0, byok_usage_monthly: 0,
      // a person of the World has bought no credits
      is_free_tier: true, is_management_key: false, is_provisioning_key: false,
      creator_user_id: key.user, organization_id: null,
      // Where the documentation stops: the World models no workspaces or regional routing; the key spends in none and
      // is routed globally
      workspace_id: null, allowed_data_regions: ['global'], expires_at: null,
      // Where the documentation stops: the daily ceiling is the spec's example (the limits page renders its figures
      // from a template); the twin serves no free variant, so none are used
      free_model_daily_requests: { used: 0, limit: 50, remaining: 50 },
      // source: spec:getCurrentKey "Legacy rate limit information about a key. Will always return -1."
      rate_limit: { requests: -1, interval: '10s', note: 'This field is deprecated and safe to ignore.' },
    },
  });
}
