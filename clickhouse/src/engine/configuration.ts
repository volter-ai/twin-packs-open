/** The served vendor configuration; interpretation and stored mutation remain in semantics. */
/** UInt64 values above JavaScript's exact integer range retain their decimal spelling. */
export type ReadonlyMode = number | string;
export type UserPolicy = { readonly: ReadonlyMode };
export type ServerConfiguration = { users?: Record<string, string>; userPolicies?: Record<string, UserPolicy>; clusters?: Record<string, string[]>; macros?: Record<string, string>; localReplication?: boolean; systemLogs?: 'disabled'; databases?: string[] };
