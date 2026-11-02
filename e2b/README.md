# @volter/twin-e2b

Protocol 3 E2B sandbox lifecycle for RH2 Task machines and Twenty's optional production code-interpreter driver. [Demand](./journeys/demand.json) pins the actual callers; [decisions](./journeys/decisions.json) names each served operation.

The `api` lane creates and kills sandboxes, lists sandboxes/templates, reconnects paused sessions and sets their timeouts. The World clock kills ordinary expired sandboxes and pauses sessions configured for persistence. The `envd` lane starts RH2's host over Connect, transfers file bytes, and forwards the filesystem Stat, ListDir, Remove and MakeDir methods. The `jupyter` lane forwards the interpreter's `/execute` stream. Both sandbox services are reached at the vendor's host and fixed port, through the World's machine pool.

Setup doors: `POST /_twin/teams` issues E2B_API_KEY; `POST /_twin/templates` enrolls a prebuilt image with `{ team?: team name (defaults to "World team"), alias, image, command?, envdVersion?, cpuCount?, memoryMB?, diskSizeMB? }`; `POST /_twin/machine-pool` enrolls the kernel pool. A Docker pool runs the registered image with its own default command, or the explicit command. RH2's host image may use `command: ["sleep", "infinity"]`. Twenty requires a locally built E2B code-interpreter template image providing envd on 49983 and its interpreter on 49999. Secure sandbox requests use the access token returned by allocation/connect. No pool runs no process; unreachable sandbox services answer an unavailable refusal. A fake pool is only for verification with explicit HTTP reply fixtures. File contents and interpreter memory live in the machine; the vendor tree holds lifecycle resources.

The API refreshes lifecycle resources through the vendor's v2 lists, and verifies signed lifecycle webhooks (killed removes the sandbox; other notifications are acknowledged, with resource state obtained by refresh). List refresh is a single page of up to 100; completeness beyond it is not claimed. The rate budget follows the cited creation allowance in the manifest.

Template builds, explicit pause, filesystem-only snapshots, context administration, unrelated filesystem/process methods, and other API operations are outside this demand and answer the declared gap. Provisioning images is the operator's work; the pack does not compile a template or evaluate Python itself.

With the current Node E2B SDK's native undici transport, pass its supported `proxy: process.env.VOLTER_WORLD_PROXY` connection option while running under World attach/run. This keeps the vendor URLs and uses the scoped HTTPS proxy. A direct native dispatcher is refused by the World's socket guard. The runtime service selects injection with `injectEnv: "E2B_TWIN_URL"`; lifecycle credentials still come from the team door. Envd supports both the per-sandbox host and the SDK's `sandbox.e2b.app` gateway with its sandbox id/port headers.

The light pool admits only `node` with a JavaScript entry file inside the guest folder.
SDK command execution beyond that entry (including `sandbox.commands.run` shell commands,
eval/flags, PTYs and other programs) is unserved. Envd answers its declared 404
`{"code":"unimplemented","message":"the method is not implemented by this twin"}` gap;
the sandbox and its file service remain available.
See the [guest capability boundary](https://github.com/volter-ai/twin-world/blob/main/docs/contributing/architecture.md#other-wires-lanes-headers-line-protocols-sockets-and-machines).
