// The Upstash Developer API's state rulings (docs/contributing/architecture.md, "What an author writes": states): the
// fields the spec's resources carry that a request never moves (a database's region and type, an account's QStash
// settings), so none is a state machine; the manifest takes each resource's whole.
export const states = {
  Database: { notState: ['state', 'type', 'primary_region', 'db_type', 'db_resource_size', 'db_acl_enabled', 'db_acl_default_user_status', 'prometheus_enabled', 'modifying_state'] },
  QStashUser: { notState: ['state', 'type', 'modifying_state', 'active', 'region', 'prometheus_enabled'] },
};
