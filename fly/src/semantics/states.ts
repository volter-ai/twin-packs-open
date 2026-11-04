// Fly's state machines (architecture, "State"): a Machine's lifecycle and a Volume's.
import type { StateField } from '@volter/world-core';

const STATES = 'https://docs.fly.io/machines/machine-states/';
const VOLUMES = 'https://docs.fly.io/machines/api/volumes-resource/';

/** A Machine's `state`: created, then launched (Fly starts it unless told not to); stopped and started by the API; a
 *  machine whose process exits stops on its own, and one with auto_destroy is then destroyed; destroyed is final. The
 *  transient states (starting, stopping, destroying) pass within the request here. */
export const machineState: StateField = {
  initial: 'created',
  transitions: [
    { actor: 'vendor', from: ['created'], to: 'started', source: `${STATES} "Machines are launched automatically upon creation"` },
    { operation: 'Machines_stop', from: ['started'], to: 'stopped', source: `${STATES} "Exited, either on its own or explicitly stopped"` },
    // Where the documentation stops: the refusals' messages are the twin's, in the API's failed_precondition form
    { operation: 'Machines_stop', from: ['created', 'stopped', 'failed', 'destroyed'], refusal: { status: 412, message: 'failed_precondition: unable to stop machine, not currently started' }, source: `${STATES} "Running and network-accessible"` },
    { operation: 'Machines_start', from: ['stopped', 'created', 'failed'], to: 'started', source: `${STATES} "Transitioning from stopped or suspended to started"` },
    { operation: 'Machines_start', from: ['started', 'destroyed'], refusal: { status: 412, message: 'failed_precondition: unable to start machine, not currently stopped' }, source: `${STATES} "Transitioning from stopped or suspended to started"` },
    { actor: 'external', from: ['started'], to: 'stopped', source: `${STATES} "Exited, either on its own or explicitly stopped"` },
    { actor: 'external', from: ['created', 'stopped', 'failed', 'destroyed'], refusal: { status: 409, message: 'the machine is not running' }, source: `${STATES} "Exited, either on its own or explicitly stopped"` },
    { actor: 'vendor', from: ['stopped'], to: 'destroyed', source: `${STATES} "No longer exists"` },
    { actor: 'vendor', from: ['created', 'stopped'], to: 'failed', source: `${STATES} "Machine encountered an error and could not start successfully"` },
    { operation: 'Machines_delete', from: ['created', 'started', 'stopped', 'failed'], to: 'destroyed', source: `${STATES} "User asked for the Machine to be completely removed"` },
  ],
};

/** A Volume's `state`: created; deleted, it is pending_destroy until Fly removes it. Where the documentation stops: the
 *  reference says only "This action cannot be undone"; the lingering pending_destroy state is the API's as Substrate
 *  observed and records it (packages/sandboxes/src/fly-provider.ts, "a deleted volume lingers as pending_destroy"). */
export const volumeState: StateField = {
  initial: 'created',
  transitions: [
    { operation: 'Volume_delete', from: ['created'], to: 'pending_destroy', source: `${VOLUMES} "Delete a volume. This action cannot be undone."` },
    { actor: 'vendor', from: ['pending_destroy'], to: 'destroyed', source: `${VOLUMES} "Delete a volume. This action cannot be undone."` },
  ],
};

export const states = {
  Machine: { state: { state: machineState }, notState: ['host_status'] },
  Volume: { state: { state: volumeState }, notState: ['host_status', 'type'] },
  App: { notState: ['status'] },
};
