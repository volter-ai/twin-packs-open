// The organizations family (/v1/organizations/…): a branch's backups, as an application asks for one (Dub's
// trigger-backup cron): `pending`, then made (./clock.ts). The answer is the kernel's view of the stored backup.
import type { HandlerContext } from '@volter/world-core';
import { BACKUP, branchOf, callerToken, databaseOf, holds, organizationOf, type Row } from './shared.ts';

const fail = (status: number, code: string, message: string): Response => Response.json({ code, message }, { status });
// A retention's units: hour, day and week a fixed length ("retention_value 6 and retention_unit hour means 6 hours"); month
// and year calendar units. Where the evidence stops: the reference names month and year but gives neither a length, so
// the twin adds them as calendar arithmetic does, the same day and time that many months or years on, a day past the
// target month's last clamped to it (Temporal's add, its default overflow).
// source: https://planetscale.com/docs/api/reference/create_backup "retention_value 6 and retention_unit hour means 6 hours"
// source: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal/PlainDateTime/add "The date component is clamped to the valid range."
const FIXED: Record<string, number> = { hour: 3_600_000, day: 86_400_000, week: 604_800_000 };
const MONTHS: Record<string, number> = { month: 1, year: 12 };
function retainedUntil(at: string, value: number, unit: string): string {
  if (Object.hasOwn(FIXED, unit)) return new Date(Date.parse(at) + value * FIXED[unit]!).toISOString();
  const d = new Date(at);
  const months = d.getUTCMonth() + value * MONTHS[unit]!;
  const year = d.getUTCFullYear() + Math.floor(months / 12);
  const month = months % 12;
  const day = Math.min(d.getUTCDate(), new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
  return new Date(Date.UTC(year, month, day, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds())).toISOString();
}

/** `POST /organizations/{org}/databases/{db}/branches/{branch}/backups` `{ name?, retention_value, retention_unit }`: with a
 *  token holding `write_backups` ("Create and update backups") on the database or its organization. Where the
 *  documentation stops: a refusal's words are the twin's. */
// source: spec:create_backup "Value between `1` and `1000` for the retention period of the backup"
export async function create_backup(ctx: HandlerContext): Promise<Response> {
  const token = callerToken(ctx);
  if (!token) return fail(401, 'unauthorized', 'Unauthorized');
  const org = organizationOf(ctx, String(ctx.call.params.organization));
  const db = org && org.id === token._organization ? databaseOf(ctx, org, String(ctx.call.params.database)) : undefined;
  const branch = db ? branchOf(ctx, db, String(ctx.call.params.branch)) : undefined;
  if (!org || !db || !branch) return fail(404, 'not_found', 'Not Found');
  if (!holds(ctx, token, 'write_backups', db)) return fail(403, 'forbidden', 'This service token does not have access to create backups on this database');
  const b = (ctx.body && typeof ctx.body === 'object' ? ctx.body : {}) as Row;
  // source: https://planetscale.com/docs/api/reference/create_backup "Emergency backups are only supported for PostgreSQL databases."
  // This lane creates Vitess/MySQL databases. Where the evidence stops: the page gives the constraint but not the status or
  // body that refuses it. The twin answers the operation's documented 422 (the class it answers any invalid parameter in);
  // its code and words are the twin's.
  // source: spec:create_backup "Unprocessable Entity"
  if (b.emergency === true) return fail(422, 'unprocessable', 'Emergency backups are only supported for PostgreSQL databases');
  const unit = String(b.retention_unit ?? 'day');
  const value = b.retention_value === undefined ? 1 : Number(b.retention_value);
  if (!(Object.hasOwn(FIXED, unit) || Object.hasOwn(MONTHS, unit)) || !Number.isInteger(value) || value < 1 || value > 1000) return fail(422, 'unprocessable', 'retention_value must be between 1 and 1000 with a retention_unit of hour, day, week, month or year');
  const id = ctx.mint('Backup');
  const at = ctx.occurredAt;
  // source: spec:/definitions/Backup "When the backup completed"
  // Pending backups have not started, completed or been deleted. Storage measures stay zero until computed;
  // the vendor documents their units and types but no pre-provisioning allocation or cost formula.
  // The actor is the service token that asked. Where the evidence stops: the spec gives an actor's avatar_url as a string
  // (the URL of its avatar) but no avatar for a service token, so the twin answers it empty.
  // source: spec:/definitions/Backup "The URL of the actor's avatar"
  await ctx.write(BACKUP, id, {
    id, name: typeof b.name === 'string' && b.name ? b.name : `${String(branch.name)}-${at}`, state: 'pending', size: 0, estimated_storage_cost: 0, pvc_size: 0, uncompressed_size: 0, started_at: null, completed_at: null, deleted_at: null, protected: false, required: false, restored_branches: [],
    created_at: at, updated_at: at, expires_at: retainedUntil(at, value, unit),
    actor: { id: token.id, display_name: token.name, avatar_url: '' }, database_branch: { id: branch.id, name: branch.name, created_at: branch.created_at, updated_at: ctx.own(branch).updated_at, deleted_at: null },
    _database: db.id, _branch: branch.id, _organization: org.name, _database_name: db.name, _branch_name: branch.name,
  }, 'backup.create');
  return Response.json(ctx.get('Backup', id), { status: 201 });
}

/** `GET /organizations/{org}/databases/{db}/branches/{branch}/backups/{id}`: one backup of the branch, with a token holding
 *  `read_backups` on the database or its organization; the World's refresh reads each backup a deploy made by it. */
// source: spec:get_backup "Returns a database branch backup"
export async function get_backup(ctx: HandlerContext): Promise<Response> {
  const token = callerToken(ctx);
  if (!token) return fail(401, 'unauthorized', 'Unauthorized');
  const org = organizationOf(ctx, String(ctx.call.params.organization));
  const db = org && org.id === token._organization ? databaseOf(ctx, org, String(ctx.call.params.database)) : undefined;
  const branch = db ? branchOf(ctx, db, String(ctx.call.params.branch)) : undefined;
  const backup = branch ? ctx.rowsRaw(BACKUP).find((b) => b.id === String(ctx.call.params.id) && b._branch === branch.id && b.deleted !== true) : undefined;
  if (!db || !backup) return fail(404, 'not_found', 'Not Found');
  // source: spec:get_backup "`read_backups`"
  if (!holds(ctx, token, 'read_backups', db)) return fail(403, 'forbidden', 'This service token does not have access to read backups on this database');
  return Response.json(ctx.get('Backup', String(backup.id)), { status: 200 });
}
