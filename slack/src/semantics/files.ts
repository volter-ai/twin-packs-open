// Slack's files.* methods (https://docs.slack.dev/reference/methods?family=files): the external upload flow — an upload
// address (files.getUploadURLExternal), the bytes sent there (../screens/files.ts), then the upload completed and
// shared (files.completeUploadExternal) — and a file's reads.
import type { HandlerContext } from '@volter/world-core';
import { arg, channelMembers, channelNamed, fail, fileView, jsonArg, now, ok, post, sees, who, type Caller } from './shared.ts';

type Row = Record<string, unknown>;

/** Unshared uploads belong to their uploader. Shared files follow their conversations' access, with bot reads
 * restricted to conversations the app joined. */
function visible(ctx: HandlerContext, file: Row, by: Caller): boolean {
  if (file.team_id !== by.team) return false;
  if (file.user === by.user) return true;
  const channels = [...((file.channels as string[]) ?? []), ...((file.groups as string[]) ?? []), ...((file.ims as string[]) ?? [])];
  // source: https://docs.slack.dev/reference/scopes/files.read/ "View files shared in channels and conversations that your Slack app has been added to"
  return channels.some((id) => {
    const channel = ctx.row('channel', id);
    return channel !== undefined && sees(ctx, channel, by)
      && (by.kind !== 'bot' || channelMembers(ctx, id).includes(by.user));
  });
}

/** files.getUploadURLExternal: "Gets a URL for an edge external file upload" for a file of `filename` and `length`
 *  bytes; answers the address the bytes go to and the file's id. The file exists, unshared, until its upload is
 *  completed. */
export async function files_getUploadURLExternal(ctx: HandlerContext): Promise<Response> {
  const by = who(ctx);
  const filename = arg(ctx, 'filename');
  const length = Number(arg(ctx, 'length'));
  if (!filename) return fail(ctx, 'invalid_arguments');
  if (!Number.isInteger(length) || length <= 0) return fail(ctx, 'invalid_arguments');
  const id = ctx.mint('file');
  const secret = ctx.crypto.digest('sha256', await ctx.secret(`upload:${id}:${ctx.occurredAt}`), 'hex').slice(0, 24);
  await ctx.write('file', id, { name: filename, size: length, user: by.user, team_id: by.team, created: now(ctx), _upload: secret, _complete: false, _received: false }, 'file.reserve');
  return ok(ctx, { upload_url: `https://files.slack.com/upload/v1/${id}/${secret}`, file_id: id });
}

/** files.completeUploadExternal: "Finishes an upload started with files.getUploadURLExternal" — each file named in
 *  `files` (JSON, `{id, title}`), whose bytes arrived; shared into `channel_id` (and `thread_ts`) as one message carrying
 *  them, `initial_comment` its text. Answers the files. */
export async function files_completeUploadExternal(ctx: HandlerContext): Promise<Response> {
  const by = who(ctx);
  const named = jsonArg(ctx, 'files');
  if (!Array.isArray(named) || named.length === 0) return fail(ctx, 'invalid_arguments');
  const files: Row[] = [];
  for (const entry of named as Row[]) {
    const f = typeof entry?.id === 'string' ? ctx.row('file', entry.id) : undefined;
    if (!f || f.user !== by.user || f._complete === true) return fail(ctx, 'file_not_found');
    if (f._received !== true) return fail(ctx, 'file_upload_not_found');
    files.push({ ...f, ...(typeof entry.title === 'string' ? { title: entry.title } : {}) });
  }
  const channelId = arg(ctx, 'channel_id') ?? arg(ctx, 'channels');
  const c = channelId ? channelNamed(ctx, channelId, by.team) : undefined;
  if (channelId && (!c || !sees(ctx, c, by))) return fail(ctx, 'channel_not_found');
  if (c && !channelMembers(ctx, String(c.id)).includes(by.user)) return fail(ctx, 'not_in_channel');
  const domain = String(ctx.get('team', by.team)?.domain ?? 'twin');
  const done: Row[] = [];
  for (const f of files) {
    const where = c ? (c.is_private === true || c.is_im === true ? { groups: c.is_private === true ? [c.id] : [], ims: c.is_im === true ? [c.id] : [] } : { channels: [c.id] }) : {};
    const written = await ctx.write('file', String(f.id), { title: f.title ?? f.name, _complete: true, ...where }, 'file.share');
    done.push(fileView(ctx, { ...f, ...written }, domain));
  }
  if (c) {
    const thread = arg(ctx, 'thread_ts');
    const m = await post(ctx, c, by, { text: arg(ctx, 'initial_comment') ?? '', files: done, upload: true, ...(thread ? { thread_ts: thread } : {}) });
    for (const f of done) await ctx.write('file', String(f.id), { _shares: [...((ctx.row('file', String(f.id))?._shares as unknown[] | undefined) ?? []), { channel: c.id, ts: m.ts }] }, 'file.share');
  }
  return ok(ctx, { files: done.map((f) => ({ id: f.id, title: f.title })) });
}

/** files.list: the workspace's completed files, newest first, by `user` and `channel` when named. */
export async function files_list(ctx: HandlerContext): Promise<Response> {
  const by = who(ctx);
  const user = arg(ctx, 'user');
  const channel = arg(ctx, 'channel');
  const all = ctx.rowsRaw('file').filter((f) => f._complete === true && visible(ctx, f, by) && (!user || f.user === user)
    && (!channel || [...((f.channels as string[]) ?? []), ...((f.groups as string[]) ?? []), ...((f.ims as string[]) ?? [])].includes(channel))).reverse();
  const count = Number(arg(ctx, 'count')) || 100;
  const pageNo = Math.max(1, Number(arg(ctx, 'page')) || 1);
  const domain = String(ctx.get('team', by.team)?.domain ?? 'twin');
  const slice = all.slice((pageNo - 1) * count, pageNo * count);
  return ok(ctx, { files: slice.map((f) => fileView(ctx, f, domain)), paging: { count, total: all.length, page: pageNo, pages: Math.max(1, Math.ceil(all.length / count)) } });
}

/** files.delete: the caller's own file ("cant_delete_file"). */
export async function files_delete(ctx: HandlerContext): Promise<Response> {
  const by = who(ctx);
  const id = arg(ctx, 'file');
  const f = id ? ctx.row('file', id) : undefined;
  if (!f) return fail(ctx, 'file_not_found');
  if (f.user !== by.user) return fail(ctx, 'cant_delete_file');
  await ctx.write('file', String(id), { deleted: true }, 'file.delete');
  return ok(ctx);
}
