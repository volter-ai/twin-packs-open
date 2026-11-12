// The driver's command table, as derived into the surface from spec/command-builders.json: the fields each command
// document can carry, and the envelope the session and connection layers add to every command.
import surface from '../generated/surface.gen.json' with { type: 'json' };

type TableCommand = { id: string; fields: Array<{ name: string }>; statements?: Record<string, Array<{ name: string }>> };
const table = new Map((surface as unknown as { commands: TableCommand[] }).commands.map((command) => [command.id, command]));
const envelope = new Set((surface as unknown as { envelope: Array<{ name: string }> }).envelope.map((field) => field.name));

/** The fields the driver can send in the named command's document. */
export const driverFields = (name: string): Set<string> => new Set((table.get(name)?.fields ?? []).map((field) => field.name));
/** Whether the driver's envelope carries the field on every command. */
export const inEnvelope = (field: string): boolean => envelope.has(field);
