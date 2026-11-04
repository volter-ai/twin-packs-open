// The envd lane's manifest: each sandbox's process door (../spec, envd's process proto as Connect operations), at
// `49983-<sandboxID>.e2b.app`: the sandbox is named in the host (`hostParams`). RH2 starts a process in its sandbox.
// It shares the vendor's store with the api lane.
import type { DerivedManifest } from '@volter/world-core';

export const manifest: DerivedManifest = {
  vendor: 'e2b',
  unmodeled: [
    "post_collapse",
    "get_envs",
    "post_files_compose",
    "Filesystem.CreateWatcher",
    "Filesystem.GetWatcherEvents",
    "Filesystem.Move",
    "Filesystem.RemoveWatcher",
    "Filesystem.WatchDir",
    "post_freeze",
    "post_fsfreeze",
    "post_fsthaw",
    "get_health",
    "post_init",
    "get_metrics",
    "Process.CloseStdin",
    "Process.Connect",
    "Process.List",
    "Process.SendInput",
    "Process.SendSignal",
    "Process.StreamInput",
    "Process.Update",
    "post_unfreeze"
  ],
  service: 'e2b',
  body: {},
  reads: ['get_files', 'Filesystem.Stat', 'Filesystem.ListDir'],
  ids: { template: '{uuid}' },
  time: 'iso',
  // Connect's error body (https://connectrpc.com/docs/protocol, "Error"): `{code, message}`
  error: { code: '{code}', message: '{message}' },
  readOnly: { status: 403, code: 'permission_denied', message: 'This twin was started read-only; writes are refused.' },
  notFound: { status: 404, code: 'not_found', message: 'not found' },
  gap: { status: 404, code: 'unimplemented', message: 'the method is not implemented by this twin' },
  headerParams: { sandboxID: 'e2b-sandbox-id', port: 'e2b-sandbox-port' },
  hostParams: '^(?<port>\\d+)-(?<sandboxID>[a-z0-9]+)\\.',
  remoteHost: { template: '49983-{sandboxID}.e2b.app' },
  deleted: {},
  resources: {},
  vendorBacked: { none: 'The sandbox service is a compute wire; lifecycle operations and refresh belong to the api lane.' },
  discovery: {
    twinOf: "a sandbox's envd process door: a process started in the sandbox, answered as a Connect stream of its events; light-pool SDK command execution beyond node with a folder-owned JS entry is unserved and answers the declared gap",
    stores: 'nothing of its own: the sandbox and its machine belong to the api lane',
  },
  descriptor: {
    protocol: '3',
    transport: 'rest',
    archetype: 'crud',
    bin: 'world-e2b-envd',
    resources: [],
    specSource: "envd's process proto (spec/SOURCE.md)",
    description: "E2B's envd lane — processes in a sandbox; light-pool SDK command execution beyond node with a folder-owned JS entry is unserved and answers the declared gap",
    adoption: { sdks: [], envStems: [] },
    hosts: [{ suffix: '.e2b.app' }],
    endpointEnvNone: 'the vendor lane',
  },
};
