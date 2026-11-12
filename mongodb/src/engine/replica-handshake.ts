type Ejson = Record<string, unknown>;
/** The mode of the real listener, carried only by the private wire capability. */
export type SingleMemberHandshake = { setName: string; self: string };

/** The Apache-2.0 driver's SDAM reader needs a member name and topology, not a changed URI.
 * This has one fixed member and no reconfiguration/election protocol. Administration remains a gap. */
// source: archive:https://registry.npmjs.org/mongodb/-/mongodb-6.20.0.tgz#sha256=a12bd599cb4f39cdf222b32380ea3efd1f60c6d88615e0700632a303a9006b02!/package/src/sdam/server_description.ts "setName"
// source: archive:https://registry.npmjs.org/mongodb/-/mongodb-6.20.0.tgz#sha256=a12bd599cb4f39cdf222b32380ea3efd1f60c6d88615e0700632a303a9006b02!/package/src/sdam/topology_description.ts "setVersion"
export function replicaHandshake(standalone: Ejson, member: SingleMemberHandshake): Ejson {
  // The driver requires sessions for retryable writes (src/utils.ts supportsRetryableWrites and
  // src/cmap/connection.ts hasSessionSupport). Do not promise sessions, transactions or txnNumber semantics.
  const { logicalSessionTimeoutMinutes: _sessions, ...reply } = standalone;
  return { ...reply, setName: member.setName, hosts: [member.self], primary: member.self, me: member.self,
    isWritablePrimary: true, secondary: false, setVersion: { $numberInt: '1' } };
}
