// The state machines, each move cited.
import type { ResourceDecl, StateField, Transition } from '@volter/world-core';



const vendor = (from: string[], to: string, source: string, effects?: Transition['effects']): Transition => ({ actor: 'vendor', from, to, source, ...(effects ? { effects } : {}) });




/** A response's `status`. A foreground response is answered
 *  `completed`; a background one is created `queued` and OpenAI works it on its own, over time on the
 *  World clock. Only a queued or in-progress one can be cancelled, and cancelling a
 *  cancelled one again answers it as it is (https://platform.openai.com/docs/guides/background). */
const BACKGROUND = 'https://platform.openai.com/docs/guides/background';



const responseStatus: StateField = {
  initial: 'completed',
  transitions: [
    {
      operation: 'cancelResponse',
      from: ['queued', 'in_progress'],
      to: 'cancelled',
      refusal: { status: 400, code: 'invalid_status', message: "Cannot cancel a response with status '{from}'." },
      source: 'spec:cancelResponse "Only responses created with the `background` parameter set to `true` can be cancelled."',
    },
    { operation: 'cancelResponse', from: ['cancelled'], source: BACKGROUND },
    // OpenAI writes a background response over time: queued, in progress, completed (semantics/responses.ts
    // times it); it may also fail it or leave it incomplete, which a stub that runs no model never does
    vendor(['queued'], 'in_progress', BACKGROUND),
    vendor(['queued', 'in_progress'], 'completed', BACKGROUND),
  ],
};




/** A run's `status`. OpenAI queues a run and works it on its own, stopping at `requires_action` for
 *  its function tools' outputs; the twin works it when a read first looks: a run with function tools
 *  stops for them (the placeholder model calls them), then, once they are submitted, ends with a labeled
 *  stub reply. Only a run in flight can be cancelled (`cancelling` until OpenAI stops it), and only one
 *  waiting on tools takes outputs. */
const RUN_DOCS = 'spec:/components/schemas/RunObject/properties/status "The status of the run, which can be either `queued`, `in_progress`, `requires_action`, `cancelling`, `cancelled`, `failed`, `completed`, `incomplete`"';



const runStatus: StateField = {
  initial: 'queued',
  transitions: [
    {
      operation: 'cancelRun',
      from: ['in_progress'],
      to: 'cancelling',
      // a run being cancelled needs no action ("Will be `null` if no action is required", RunObject.required_action)
      effects: { required_action: { value: null } },
      source: 'spec:cancelRun "Cancels a run that is `in_progress`."',
    },
    { operation: 'cancelRun', from: ['queued', 'requires_action', 'cancelling', 'cancelled', 'failed', 'completed', 'incomplete', 'expired'],
      refusal: { status: 400, message: "Cannot cancel run with status '{from}'." },
      source: 'spec:cancelRun "Cancels a run that is `in_progress`."',
    },
    {
      operation: 'submitToolOuputsToRun',
      from: ['requires_action'],
      to: 'queued',
      refusal: { status: 400, message: 'Runs in status "{from}" do not accept tool outputs.' },
      source: 'spec:submitToolOuputsToRun "When a run has the `status: "requires_action"`"',
    },
    vendor(['queued'], 'in_progress', RUN_DOCS, { started_at: { now: true } }),
    vendor(['in_progress'], 'completed', RUN_DOCS, { completed_at: { now: true } }),
    // a run whose model calls its function tools stops for their outputs
    // (https://platform.openai.com/docs/assistants/tools/function-calling)
    vendor(['in_progress'], 'requires_action', RUN_DOCS),
    vendor(['cancelling'], 'cancelled', RUN_DOCS, { cancelled_at: { now: true } }),
    // a run still waiting on its tools' outputs at its `expires_at` expires then (semantics/clock.ts)
    vendor(['requires_action'], 'expired', 'spec:/components/schemas/RunObject/properties/expires_at "The Unix timestamp (in seconds) for when the run will expire."'),
    // OpenAI also fails a run or leaves it incomplete; the twin's stub model never does
  ],
};




export const states = {
  _codex_code: { state: { status: { initial: 'fresh', transitions: [
    { operation: 'auth.token', from: ['fresh'], to: 'consumed', source: 'https://raw.githubusercontent.com/openai/codex/78c290807ce710180111df227df3b7a4fe845452/codex-rs/login/src/server.rs "grant_type=authorization_code"' },
    { operation: 'auth.token', from: ['consumed'], refusal: { status: 400, code: 'invalid_grant', message: 'Authorization code is no longer valid.' }, source: 'https://raw.githubusercontent.com/openai/codex/78c290807ce710180111df227df3b7a4fe845452/codex-rs/login/src/server.rs "grant_type=authorization_code"' },
  ] } } },
  _codex_device: { state: { status: { initial: 'pending', transitions: [
    { actor: 'external', from: ['pending'], to: 'approved', source: 'https://raw.githubusercontent.com/openai/codex/78c290807ce710180111df227df3b7a4fe845452/codex-rs/login/src/device_code_auth.rs "device auth timed out after 15 minutes"' },
    { actor: 'external', from: ['approved', 'consumed'], refusal: { status: 403, code: 'access_denied', message: 'This device request is no longer pending.' }, source: 'https://raw.githubusercontent.com/openai/codex/78c290807ce710180111df227df3b7a4fe845452/codex-rs/login/src/device_code_auth.rs "device auth timed out after 15 minutes"' },
    { operation: 'auth.poll', from: ['approved'], to: 'consumed', source: 'https://raw.githubusercontent.com/openai/codex/78c290807ce710180111df227df3b7a4fe845452/codex-rs/login/src/device_code_auth.rs "device auth timed out after 15 minutes"' },
    { operation: 'auth.poll', from: ['pending', 'consumed'], refusal: { status: 403, code: 'authorization_pending', message: 'Device authorization is pending or no longer available.' }, source: 'https://raw.githubusercontent.com/openai/codex/78c290807ce710180111df227df3b7a4fe845452/codex-rs/login/src/device_code_auth.rs "device auth timed out after 15 minutes"' },
  ] } } },
  _codex_grant: { state: { status: { initial: 'active', transitions: [
    { operation: 'auth.token', from: ['active'], to: 'rotated', source: 'https://raw.githubusercontent.com/openai/codex/78c290807ce710180111df227df3b7a4fe845452/codex-rs/login/src/auth/manager.rs "refresh_token_reused"' },
    { operation: 'auth.token', from: ['rotated'], refusal: { status: 401, code: 'refresh_token_reused', message: 'Refresh token has already been used.' }, source: 'https://raw.githubusercontent.com/openai/codex/78c290807ce710180111df227df3b7a4fe845452/codex-rs/login/src/auth/manager.rs "refresh_token_reused"' },
    { operation: 'auth.token', from: ['revoked'], refusal: { status: 401, code: 'refresh_token_invalidated', message: 'Refresh token was revoked.' }, source: 'https://raw.githubusercontent.com/openai/codex/78c290807ce710180111df227df3b7a4fe845452/codex-rs/login/src/auth/manager.rs "refresh_token_reused"' },
    { operation: 'auth.revoke', from: ['active', 'rotated', 'revoked'], to: 'revoked', source: 'https://raw.githubusercontent.com/openai/codex/78c290807ce710180111df227df3b7a4fe845452/codex-rs/login/src/auth/revoke.rs "Logout attempts to revoke the"' },
  ] } } },
  // source: spec:/components/schemas/VectorStoreObject/properties/status "The status of the vector store"
  VectorStoreObject: { state: { status: { initial: "completed", transitions: [] } } },
  OpenAIFile: { notState: ['purpose', 'status'] },
  Response: { state: { status: responseStatus } },
  ItemResource: { notState: ['execution', 'role', 'status'] },
  MessageObject: { notState: ['role', 'status'] },
  RunObject: { state: { status: runStatus } },
  RunStepObject: { notState: ['status', 'type'] },
  Project: { state: { status: { initial: 'active', transitions: [] } }, notState: ['residency'] },
  ProjectApiKey: { notState: ['owner_project_access'] },
} satisfies Record<string, Pick<ResourceDecl, 'state' | 'notState'>>;
