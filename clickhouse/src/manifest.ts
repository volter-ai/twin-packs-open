import type { DerivedManifest } from '@volter/world-core';
import { states } from './semantics/states.ts';

export const manifest: DerivedManifest = {
  vendor: 'clickhouse', service: 'clickhouse', ids: { template: '{uuid}' }, time: 'iso',
  body: {}, encodings: { request: ['gzip'], response: ['gzip'], undecodable: { status: 500, code: 117, message: 'Cannot decode request body' } }, reads: ['query_get', 'query_post', 'ping'],
  error: 'Code: {code}. DB::Exception: {message}.\n', readOnly: { status: 500, code: 164, message: 'Cannot execute query in readonly mode' },
  notFound: { status: 500, code: 60, message: 'Table does not exist' },
  deleted: {},
  resources: {
    database: { idPrefix: '', ...states.database, unique: [{ fields: ['name'], refusal: { status: 500, code: 82, message: 'Database already exists' } }] },
    table: { idPrefix: '', ...states.table, unique: [{ fields: ['database', 'name'], refusal: { status: 500, code: 57, message: 'Table already exists' } }, { fields: ['replicationPath', 'replica'], refusal: { status: 500, code: 253, message: 'Replica already exists' } }] },
    _replication: { idPrefix: '', unique: [{ fields: ['path'], refusal: { status: 500, code: 122, message: 'Replication schema differs' } }] },
    row: { idPrefix: '', ...states.row },
    _configuration: { idPrefix: '' },
  },
  discovery: { twinOf: 'ClickHouse SQL server', stores: 'databases, table schemas and inserted rows in the World store' },
  doors: [{ id: 'configuration', method: 'POST', path: '/_twin/configuration', note: 'Server operator configuration: clusters:{name:[local]}, users:{name:password}, userPolicies:{name:{readonly:UInt64}}, macros:{name:value}, localReplication:true. readonly1 refuses changed client settings; unresolved default comparisons remain explicit gaps. Verified source users/policies cannot be changed or removed by this door. Remote fanout is refused.' }],
  descriptor: {
    protocol: '3', transport: 'rest', archetype: 'crud', bin: 'world-clickhouse',
    resources: ['database', 'table', 'row'], specSource: 'spec/openapi.json authored from ClickHouse HTTP reference; native packet references in spec/SOURCE.md',
    description: 'ClickHouse SQL over the World store through HTTP and native TCP.',
    managedService: { kind: 'clickhouse', scheme: 'http', configurationArg: '--configuration', originalInputs: { version: 1, manifestArg: '--original-inputs', rootArg: '--original-root', digestArg: '--original-inputs-sha256', paths: ['/etc/clickhouse-server', '/docker-entrypoint-initdb.d', '/entrypoint.sh'] }, note: 'One HTTP8123/native9000 process and store; declared operator configuration is installed before listeners.' },
    sidePorts: [{ name: 'native', option: 'nativePort', flag: '--native-port', note: 'ClickHouse native TCP protocol, normally9000, beside HTTP8123.' }],
    adoption: { sdks: ['@clickhouse/client', '@clickhouse/client-web'], pypi: ['clickhouse-driver', 'clickhouse-connect', 'infi-clickhouse-orm'], envStems: ['CLICKHOUSE'] },
    hostsNone: 'Self-hosted database: its own declared host and allocated listener are supplied by managed infrastructure.',
    endpointEnv: { name: 'CLICKHOUSE_URL', note: 'HTTP base URL read by the documented JavaScript client.' },
  },
};
