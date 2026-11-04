# @volter/twin-fly

The Fly Machines API for Substrate's workspace lifecycle: organization apps, persistent volumes,
machines created, waited on, paused, resumed and destroyed. See [demand](journeys/demand.json)
and [decisions](journeys/decisions.json). The vendored Machines specification owns the wire shapes.

The World doors issue organization/app-scoped throwaway tokens (`POST /_twin/tokens`, `{ org, app? }`),
enroll the kernel machine pool (`POST /_twin/machine-pool`, `{ kind: "fake" | "none" | "docker" }`),
and represent a process exiting (`POST /_twin/machines/{id}/exit`). Credentials fill `FLY_API_TOKEN`;
Substrate reads the endpoint from `FLY_API_HOSTNAME`. A fake pool verifies calls without running an
image; Docker executes supported image/env/command/ports through the World-owned pool. Volumes are
API state; this pack does not claim to mount their bytes into Docker guests. `twin_local_ports` is
the disclosed World extension Substrate uses to connect to a local guest.

Refresh reads token organizations, their apps, and each app's machines and volumes. Vendor resource
views omit kernel metadata. A deleted volume remains pending_destroy until the World clock passes
24 hours, a simulation delay absent from the vendor reference. Fly's deletion response says destroyed;
the pack discloses its observed pending_destroy behavior in the examples' recorded difference.

Certificates, IP assignments, secrets, Postgres, leases, exec, updates, suspension, snapshots and
other operations in the literal `unmodeled` list answer the documented gap. No dashboard screens:
this workflow uses the Machines API; Fly's console is incidental account and deployment tooling.

The light pool admits only `node` with a JavaScript entry file inside the guest folder.
SDK command execution beyond that entry (shells, eval/flags, PTYs and other programs) is unserved.
Command admission answers the manifest's 404 `{"error":"not found"}` gap before creating a machine,
including a create with `skip_launch`. A stopped machine's start uses the same admission.
See the [guest capability boundary](../../twin-world/docs/contributing/architecture.md#other-wires-lanes-headers-line-protocols-sockets-and-machines).
