import type { DerivedManifest } from '@volter/world-core';
import { states } from './semantics/states.ts';
export const manifest: DerivedManifest = {
  vendor: 'openai', service: 'openai', body: {}, ids: { template: '{uuid}' }, time: 'unix',
  // The client selects Zstd only for enabled compression, Codex backend auth and the OpenAI provider; otherwise JSON is uncompressed.
  // source: https://raw.githubusercontent.com/openai/codex/78c290807ce710180111df227df3b7a4fe845452/codex-rs/core/src/client.rs "Compression::Zstd"
  // source: https://raw.githubusercontent.com/openai/codex/78c290807ce710180111df227df3b7a4fe845452/codex-rs/http-client/src/request.rs "RequestCompression::Zstd"
  encodings: { request: ['zstd'] },
  // source: https://raw.githubusercontent.com/openai/codex/78c290807ce710180111df227df3b7a4fe845452/codex-rs/login/src/auth/manager.rs "Value::Object(map)"
  error: { error: { code: '{code}', message: '{message}', type: '{kind}' } },
  // The client accepts unsuccessful status plus its body; no private 404 wording is documented.
  // source: https://raw.githubusercontent.com/openai/codex/78c290807ce710180111df227df3b7a4fe845452/codex-rs/backend-client/src/client.rs "if !status.is_success()"
  gap: { status: 404, code: 'not_found', message: 'Not Found' },
  notFound: { status: 404, code: 'not_found', message: 'Not Found' },
  readOnly: { status: 403, code: 'access_denied', message: 'This World is read only.' },
  deleted: {}, list: { style: 'envelope', envelope: { data: '{data}' }, limit: { param: 'limit', default: 20, max: 100 } },
  resources: { _codex_nonce: { storedAs: '_codex_nonce', idPrefix: 'nonce' }, _codex_account: { storedAs: '_codex_account', idPrefix: 'acct' },
    _codex_code: { storedAs: '_codex_code', idPrefix: 'code', ...states._codex_code },
    _codex_device: { storedAs: '_codex_device', idPrefix: 'device', ...states._codex_device },
    _codex_grant: { storedAs: '_codex_grant', idPrefix: 'grant', ...states._codex_grant },
    _codex_call: { storedAs: '_codex_call', idPrefix: 'resp' }, },
  rateBudget: { windowMs: 60_000, ceiling: 30, defaultWeight: 1, maxRetryAfterSeconds: 120, reason: 'The private subscription API publishes no request allowance; use the kernel fallback of 30 calls per minute.' },
  vendorBacked: { none: 'Subscription model turns are not vendor-stored; OAuth custody and synthetic account policy are private World bookkeeping, not deployable vendor resources.' },
  unmodeled: ['wham.tasks_list', 'wham.tasks', 'wham.tasks_turns_sibling_turns', 'wham.config_bundle', 'wham.create_task', 'wham.accounts_send_add_credits_nudge_email', 'wham.settings_user'],
  screens: [
    { id: 'authorize', kind: 'flow', host: 'auth.openai.com', path: '/oauth/authorize', status: 'done', demand: 'Harness browser Codex login', controls: ['Email address', 'Password', 'Continue'], source: 'https://developers.openai.com/codex/auth' },
    { id: 'device', kind: 'flow', host: 'auth.openai.com', path: '/codex/device', status: 'done', demand: 'Substrate and Harness device code sign-in', controls: ['Email address', 'Password', 'One-time code', 'Continue'], source: 'https://developers.openai.com/codex/auth' },
  ],
  // source: https://raw.githubusercontent.com/openai/codex/78c290807ce710180111df227df3b7a4fe845452/codex-rs/core/src/client.rs "WebSocket use is controlled by provider capability"
  sockets: [{ id: 'codexResponses', path: '/backend-api/codex/responses', host: 'chatgpt.com', note: 'Native Codex Responses, response.create and prewarm', source: 'https://raw.githubusercontent.com/openai/codex/78c290807ce710180111df227df3b7a4fe845452/codex-rs/codex-api/src/endpoint/responses_websocket.rs' }],
  discovery: { twinOf: 'OpenAI Codex subscription backend and ChatGPT browser/device authentication', stores: 'World-issued OAuth grants, one-use codes and device consent; private model-call records', behavior: 'Configured deterministic scripts or labeled stubs; no model runs.' },
};
