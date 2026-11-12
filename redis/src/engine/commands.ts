// The derived command table's pure lookup; runtime state lives only in the kernel.
import surface from '../generated/surface.gen.json' with { type: 'json' };
const table = new Map(surface.commands.map((c) => [c.id, c]));
export const command = (id: string) => table.get(id);
