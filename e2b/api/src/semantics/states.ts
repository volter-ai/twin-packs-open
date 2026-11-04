// A sandbox runs, auto-pauses at its configured timeout, and resumes on connect or enabled traffic.
// Killing removes its subject; filesystem-only snapshots and explicit pause are outside the demand.
import type { StateField } from '@volter/world-core';
const sandboxState: StateField = {
  initial: 'running',
  transitions: [
    { actor: 'vendor', from: ['running'], to: 'paused', source: 'spec:/components/schemas/NewSandbox "Automatically pauses the sandbox after the timeout"' },
    { operation: 'post_sandboxes_sandboxid_connect', from: ['paused'], to: 'running', source: 'spec:post_sandboxes_sandboxid_connect "If the sandbox is paused, it will be resumed."' },
    { actor: 'vendor', from: ['paused'], to: 'running', source: 'spec:/components/schemas/SandboxAutoResumeEnabled "Auto-resume enabled flag for paused sandboxes. Default false."' },
  ],
};
export const states = { sandbox: { state: { state: sandboxState } }, template: {} };
