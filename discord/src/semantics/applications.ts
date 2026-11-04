// Applications: a bot's read of its own application (its id, verify_key and server count), which Volter Harness's
// Chat SDK reads for the id and verify_key it needs and a refresh reads back; and the application's global slash
// commands, which Hermes reconciles on every start (listed, the obsolete deleted, the missing created, the changed
// edited) and a refresh reads back. Guild commands, the bulk overwrite and the user, message and entry point command
// types answer the gap.
import type { HandlerContext } from '@volter/world-core';
import {
  appView, authorized, COMMAND, commandApp, commandFields, commandInvalid, commandsOf, commandVersion, commandView, fail, gap, obj, queryTrue, type Row, unknown,
} from './shared.ts';

// source: https://docs.discord.com/developers/resources/application "object associated with the requesting bot user"
export async function get_my_application(ctx: HandlerContext): Promise<Response> {
  const c = authorized(ctx);
  if (c instanceof Response) return c;
  if (c.kind !== 'bot') return Response.json({ message: '401: Unauthorized', code: 0 }, { status: 401 });
  return Response.json(appView(ctx, c.app));
}

// source: https://docs.discord.com/developers/interactions/application-commands "Fetch all of the global commands for your application. Returns an array of application command objects."
export async function list_application_commands(ctx: HandlerContext): Promise<Response> {
  const app = commandApp(ctx);
  if (app instanceof Response) return app;
  const full = queryTrue(ctx, 'with_localizations');
  return Response.json(commandsOf(ctx, String(app.id)).map((r) => commandView(ctx, r, full)));
}

// source: https://docs.discord.com/developers/interactions/application-commands "Create a new global command. Returns 201 if a command with the same name does not already exist, or a 200 if it does (in which case the previous command will be overwritten)."
export async function create_application_command(ctx: HandlerContext): Promise<Response> {
  const app = commandApp(ctx);
  if (app instanceof Response) return app;
  const b = obj(ctx.body);
  // source: https://docs.discord.com/developers/interactions/application-commands "Type of command, defaults 1 if not set"
  const type = Number(b.type ?? 1);
  // the user, message and entry point types are documented variants no demand and no life step asks for: the gap
  if (type !== 1) return gap();
  const refused = commandInvalid(b, false);
  if (refused) return refused;
  const commands = commandsOf(ctx, String(app.id));
  const same = commands.find((r) => r.name === b.name);
  // source: https://docs.discord.com/developers/interactions/application-commands "100 global CHAT_INPUT commands"
  if (!same && commands.length >= 100) return fail(400, 30032, 'Maximum number of application commands reached');
  const id = same ? String(same.id) : ctx.mint(COMMAND);
  // a create sets the whole command: what it leaves out takes the default again
  await ctx.write(COMMAND, id, {
    id, application_id: app.id, version: await commandVersion(ctx, id), default_member_permissions: null, type: 1, name: b.name, name_localizations: null, description: b.description,
    description_localizations: null, dm_permission: true, contexts: null, integration_types: null, options: [], nsfw: false, ...commandFields({ integration_types: null, ...b }, app),
  }, same ? 'command.update' : 'command.create');
  return Response.json(commandView(ctx, ctx.row(COMMAND, id)!), { status: same ? 200 : 201 });
}

/** The caller's command the path names, or Unknown Application Command. */
// source: https://docs.discord.com/developers/topics/opcodes-and-status-codes "Unknown application command"
function commandAt(ctx: HandlerContext, app: Row): Row | Response {
  const r = ctx.row(COMMAND, String(ctx.call.params.command_id));
  return r && r.deleted !== true && r.application_id === app.id ? r : unknown(10063, 'application command');
}

// source: https://docs.discord.com/developers/interactions/application-commands "Edit a global command. Returns 200 and an application command object. All fields are optional, but any fields provided will entirely overwrite the existing values of those fields."
export async function update_application_command(ctx: HandlerContext): Promise<Response> {
  const app = commandApp(ctx);
  if (app instanceof Response) return app;
  const current = commandAt(ctx, app);
  if (current instanceof Response) return current;
  const b = obj(ctx.body);
  const refused = commandInvalid(b, true);
  if (refused) return refused;
  // source: https://docs.discord.com/developers/interactions/application-commands "Your app cannot have two global CHAT_INPUT commands with the same name"
  if (b.name !== undefined && commandsOf(ctx, String(app.id)).some((r) => r.name === b.name && r.id !== current.id)) return fail(400, 40041, 'An application command with that name already exists');
  const id = String(current.id);
  await ctx.write(COMMAND, id, { ...commandFields(b, app), version: await commandVersion(ctx, id) }, 'command.update');
  return Response.json(commandView(ctx, ctx.row(COMMAND, id)!));
}

// source: https://docs.discord.com/developers/interactions/application-commands "Deletes a global command. Returns 204 No Content on success."
export async function delete_application_command(ctx: HandlerContext): Promise<Response> {
  const app = commandApp(ctx);
  if (app instanceof Response) return app;
  const current = commandAt(ctx, app);
  if (current instanceof Response) return current;
  await ctx.remove(COMMAND, String(current.id), 'command.delete');
  return new Response(null, { status: 204 });
}
