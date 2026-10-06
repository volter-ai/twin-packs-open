import type { HandlerContext } from '@volter/world-core';
import { codexBody, codexError, codexGrant, epoch } from './shared.ts';
// Synthetic Plus account policy, in the shapes the vendor ships. No documented numeric subscription limit is claimed.
// source: https://raw.githubusercontent.com/openai/codex/78c290807ce710180111df227df3b7a4fe845452/codex-rs/codex-backend-openapi-models/src/models/rate_limit_status_payload.rs "pub plan_type: PlanType"
// source: https://raw.githubusercontent.com/openai/codex/78c290807ce710180111df227df3b7a4fe845452/codex-rs/codex-backend-openapi-models/src/models/rate_limit_status_details.rs "pub allowed: bool"
export async function wham_usage(ctx: HandlerContext): Promise<Response> {
  const auth = codexGrant(ctx); if (auth instanceof Response) return auth;
  const window = { used_percent: 0, limit_window_seconds: 18000, reset_after_seconds: 18000, reset_at: epoch(ctx) + 18000 };
  return Response.json({ plan_type: 'plus', rate_limit: { allowed: true, limit_reached: false, primary_window: window, secondary_window: null }, credits: { has_credits: false, unlimited: false, balance: '0' }, rate_limit_reset_credits: { available_count: 0 } });
}
// source: https://raw.githubusercontent.com/openai/codex/78c290807ce710180111df227df3b7a4fe845452/codex-rs/backend-client/src/types.rs "pub struct TokenUsageProfileStats"
export async function wham_profile(ctx: HandlerContext): Promise<Response> {
  const auth = codexGrant(ctx); if (auth instanceof Response) return auth;
  const calls = ctx.rowsRaw('_codex_call').filter(r => r._account === auth._account);
  const total = calls.reduce((n, r) => n + Number((r._usage as { total_tokens?: number } | undefined)?.total_tokens ?? 0), 0);
  return Response.json({ stats: { lifetime_tokens: total, peak_daily_tokens: null, longest_running_turn_sec: null, current_streak_days: null, longest_streak_days: null, daily_usage_buckets: null } });
}
// source: https://raw.githubusercontent.com/openai/codex/78c290807ce710180111df227df3b7a4fe845452/codex-rs/backend-client/src/types.rs "pub messages: Vec<CodexWorkspaceMessage>"
export async function wham_messages(ctx: HandlerContext): Promise<Response> {
  const auth = codexGrant(ctx); if (auth instanceof Response) return auth;
  return Response.json({ messages: [] });
}
// source: https://raw.githubusercontent.com/openai/codex/78c290807ce710180111df227df3b7a4fe845452/codex-rs/backend-client/src/types.rs "pub credits: Vec<RateLimitResetCreditDetails>"
export async function wham_credits(ctx: HandlerContext): Promise<Response> {
  const auth = codexGrant(ctx); if (auth instanceof Response) return auth;
  return Response.json({ credits: [], available_count: 0 });
}
// With no synthetic purchased reset credit the vendor client has the no_credit result; no stored mutation is faked.
// source: https://raw.githubusercontent.com/openai/codex/78c290807ce710180111df227df3b7a4fe845452/codex-rs/backend-client/src/types.rs "NoCredit"
export async function wham_consume(ctx: HandlerContext): Promise<Response> {
  const auth = codexGrant(ctx); if (auth instanceof Response) return auth;
  if (typeof codexBody(ctx).redeem_request_id !== 'string' || !codexBody(ctx).redeem_request_id) return codexError('invalid_request', 'redeem_request_id is required.');
  return Response.json({ code: 'no_credit', windows_reset: 0 });
}

// source: spec:/calls/13 "/backend-api/wham/accounts/check"
// source: recording:accounts-check.rs "pub struct AccountsCheckResponse"
// source: recording:accounts-check.rs "pub structure: String"
// This World has one synthetic personal subscription account; no live workspace is inferred.
export async function wham_accounts_check(ctx: HandlerContext): Promise<Response> {
  const auth = codexGrant(ctx); if (auth instanceof Response) return auth;
  const id = String(auth._account);
  return Response.json({ accounts: [{ id, name: 'World Codex account', profile_picture_url: null, structure: 'personal' }], account_ordering: [id], default_account_id: id });
}
