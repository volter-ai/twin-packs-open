// The management API's state machines (docs/contributing/architecture.md, "What an author writes": states), each move
// cited, and its rulings of what is not state; the manifest takes each resource's whole.
import type { StateField } from '@volter/world-core';

/** A database's `state`: a new database is `pending`, and PlanetScale provisions it ("After creation, poll
 *  `get_database` until `ready` is `true`"). The twin's is ready a minute after it was made, on the World clock
 *  (./clock.ts): how long provisioning takes is the twin's decision. */
const databaseState: StateField = {
  initial: 'pending',
  transitions: [{ actor: 'time', from: ['pending'], to: 'ready', source: 'spec:/definitions/Database/properties/ready "If the database is ready to be used"' }],
};

/** A backup's `state`: a new backup is `pending`, starts `running` and ends `success`. The twin's starts 30 seconds after
 *  it was asked for and completes two minutes after (./clock.ts): the timing is the twin's decision. */
const backupState: StateField = {
  initial: 'pending',
  transitions: [
    { actor: 'time', from: ['pending'], to: 'running', source: 'spec:/definitions/Backup/properties/state "The current state of the backup"' },
    { actor: 'time', from: ['running'], to: 'success', source: 'spec:/definitions/Backup/properties/state "The current state of the backup"' },
  ],
};

export const states = {
  Database: { state: { state: databaseState }, notState: ['kind', 'plan', 'region', 'sharded', 'automatic_migrations', 'migration_framework', 'migration_table_name', 'insights_enabled', 'production_branch_web_console', 'allow_data_branching', 'foreign_keys_enabled', 'require_approval_for_deploy', 'deletion_protected', 'ready'] },
  // a branch made with its database: ready with it; its settings are fixed by what the dashboard makes
  DatabaseBranch: { notState: ['state', 'kind', 'ready', 'schema_ready', 'production', 'safe_migrations', 'sharded', 'region', 'cluster_name', 'deletion_protected'] },
  // a password's role is fixed when it is made ("roles cannot be changed", the Connect page's role list)
  DatabaseBranchPassword: { notState: ['role', 'replica', 'renewable', 'expired', 'region', 'read_only_region', 'direct_vtgate'] },
  ServiceToken: { notState: ['actor_type'] },
  Backup: { state: { state: backupState }, notState: ['protected', 'required'] },
};
