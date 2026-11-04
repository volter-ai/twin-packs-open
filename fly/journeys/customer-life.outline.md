# Substrate workspaces on Fly Machines

Author: Contributor 2. The Substrate operator uses an organization token for `personal` and
creates its sandbox app there. Substrate uses that same token for its app, volumes and machines.
The World supplies a fake machine pool for deterministic API verification; no container runs in
this journey. A developer uses Substrate to allocate, pause, resume and release their workspace.
Fly's console is incidental to this code-driven Machines workflow, so the pack has no screens.

1. **Provisioning.** The operator enrolls the World pool and obtains an organization token. Before
   connecting the app, they confirm the token's organization and inventory. Substrate's app-existence
   probe finds no sandbox app and creates one. It finds no workspace volume and allocates one in iad.
   It launches a workspace machine with the mounted volume, its sandbox environment and TCP service
   on 8787; it waits for started and reads the address and local forwarding port to connect.
2. **End of the first day.** The developer pauses their workspace. Substrate stops the machine and
   waits for stopped; a monitoring process reads the machine so it can confirm that its port is no
   longer published. The next morning the developer resumes: Substrate starts it, waits for started,
   and reads its new instance/address. The volume remains attached through the restart.
3. **Retirement.** A day later, the operator attempts to remove the workspace volume before its
   still-running machine and receives the attached-volume precondition error. They destroy the machine
   with force, then Substrate's reconciliation lists running sandboxes and sees none. They remove the
   detached volume. Its pending_destroy period is observed by the next day's workspace reconciliation:
   Substrate ignores it; after another day the World has removed it. The 24-hour removal delay is
   explicitly a simulation choice, because Fly's public reference specifies no delay.
