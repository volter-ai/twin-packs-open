import type { HandlerContext } from '@volter/world-core';
import { machineRequest, lifecycle, fileFailure, lightFiles, filesystemEntry, filePath } from './shared.ts';

// source: spec:Filesystem.Stat "Stat"
export async function Filesystem_Stat(ctx: HandlerContext): Promise<Response> {
  if (ctx.machines.kind !== 'light') return machineRequest(ctx, 49983, lifecycle);
  try {
    const files = await lightFiles(ctx, lifecycle); if (files instanceof Response) return files;
    const body = await ctx.call.request.json() as { path: string };
    return Response.json({ entry: await filesystemEntry(files, body.path) });
  } catch (error) { return fileFailure(error, false); }
}

// source: spec:Filesystem.MakeDir "MakeDir"
export async function Filesystem_MakeDir(ctx: HandlerContext): Promise<Response> {
  if (ctx.machines.kind !== 'light') return machineRequest(ctx, 49983, lifecycle);
  try {
    const files = await lightFiles(ctx, lifecycle); if (files instanceof Response) return files;
    const body = await ctx.call.request.json() as { path: string };
    await files.mkdir(body.path);
    return Response.json({ entry: await filesystemEntry(files, body.path) });
  } catch (error) { return fileFailure(error, false); }
}

// source: spec:Filesystem.ListDir "ListDir"
export async function Filesystem_ListDir(ctx: HandlerContext): Promise<Response> {
  if (ctx.machines.kind !== 'light') return machineRequest(ctx, 49983, lifecycle);
  try {
    const files = await lightFiles(ctx, lifecycle); if (files instanceof Response) return files;
    const body = await ctx.call.request.json() as { path: string; depth?: number };
    const entries: Record<string, unknown>[] = [];
    const visit = async (path: string, depth: number): Promise<void> => {
      for (const item of await files.list(path)) {
        const child = filePath(path, item.name); entries.push(await filesystemEntry(files, child));
        if (depth > 1 && item.type === 'directory') await visit(child, depth - 1);
      }
    };
    await visit(body.path, body.depth ?? 1);
    return Response.json({ entries });
  } catch (error) { return fileFailure(error, false); }
}

// source: spec:Filesystem.Remove "Remove"
export async function Filesystem_Remove(ctx: HandlerContext): Promise<Response> {
  if (ctx.machines.kind !== 'light') return machineRequest(ctx, 49983, lifecycle);
  try {
    const files = await lightFiles(ctx, lifecycle); if (files instanceof Response) return files;
    const body = await ctx.call.request.json() as { path: string };
    await files.remove(body.path); return Response.json({});
  } catch (error) { return fileFailure(error, false); }
}
