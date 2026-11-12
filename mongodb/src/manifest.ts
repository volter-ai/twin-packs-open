import type { DerivedManifest } from '@volter/world-core';

// MongoDB publishes no spec a pack may derive from (spec/SOURCE.md): what a client can send is the driver's command
// table, and what the server does is recorded answers of the vendor's own server.
// source: recording:hello.json "isWritablePrimary"
export const manifest: DerivedManifest = {
  vendor: 'mongodb', service: 'mongodb', body: {}, deleted: undefined,
  // A document is identified by its database, its collection and its _id, which the caller usually supplies;
  // ids.template is unused by the command engine.
  ids: { template: '{uuid}' }, time: 'unix-ms',
  // source: recording:unknown-command.json "no such command: 'noSuchCommand'"
  error: { ok: 0, errmsg: '{message}' },
  readOnly: { status: 403, message: 'not primary' },
  // source: recording:unknown-command.json "CommandNotFound"
  notFound: { status: 400, message: 'no such command' },
  // What the engine keeps, each a subject of the World's tree: a collection of a database, an index of a
  // collection, a document of a collection. Per-command evidence is journeys/decisions.json; this wire has no HTTP
  // list contract.
  resources: {
    collection: { idPrefix: 'col' },
    index: { idPrefix: 'idx' },
    document: { idPrefix: 'doc' },
  },
  vendorBacked: { none: 'A managed loopback MongoDB owns the World tree; commands are not replayable HTTP resource mutations and no external MongoDB is deployed or refreshed.' },
  discovery: { twinOf: 'MongoDB Community 7.0 over its wire protocol: standalone by default, or a declared single-member handshake without sessions', stores: 'collections, indexes and documents by database in the World tree, each value with its BSON type; connection state is ephemeral' },
  // every command of the table the engine does not answer yet is the gap, answered as the vendor answers an unknown command
  unmodeled: ["count", "dbStats", "drop", "dropDatabase", "dropIndexes", "dropUser", "getMore", "killCursors", "listDatabases", "profile", "renameCollection", "validate"],
  descriptor: {
    protocol: '3', transport: 'raw-tcp', archetype: 'crud', bin: 'world-mongodb',
    resources: ['collection', 'index', 'document'],
    specSource: "MongoDB's Node driver 6.20.0 (Apache-2.0) as the command table, and recordings of MongoDB Community 7.0.16; archive digest and commit in spec/SOURCE.md",
    description: 'MongoDB over its own wire for an application whose database it is: LibreChat through mongoose.',
    managedService: { kind: 'mongodb', scheme: 'mongodb', note: 'MongoDB 7.0 wire: standalone, or a declared single-member handshake without sessions; state in the World tree' },
    adoption: { sdks: ['mongodb', 'mongoose'], envStems: ['MONGODB', 'MONGO'] }, hosts: [],
    endpointEnvNone: 'Managed infrastructure injects the connection address from the declared mongodb service; it is a TCP endpoint, with no HTTP API host.',
  },
};
