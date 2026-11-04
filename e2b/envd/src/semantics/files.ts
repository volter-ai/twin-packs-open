import type { HandlerContext } from '@volter/world-core';
import { machineRequest, lifecycle, fileFailure, lightFiles, fileName, filePath } from './shared.ts';

// source: spec:get_files "Download a file"
export async function get_files(ctx: HandlerContext): Promise<Response> {
  if (ctx.machines.kind !== 'light') return machineRequest(ctx, 49983, lifecycle);
  try {
    const files = await lightFiles(ctx, lifecycle); if (files instanceof Response) return fileFailure(files, true);
    const path = new URL(ctx.call.request.url).searchParams.get('path');
    if (!path) throw new Error('path is required');
    return new Response(new Uint8Array(await files.read(path)).buffer);
  } catch (error) { return fileFailure(error, true); }
}

// source: spec:post_files "Upload a file"
export async function post_files(ctx: HandlerContext): Promise<Response> {
  if (ctx.machines.kind !== 'light') return machineRequest(ctx, 49983, lifecycle);
  try {
    const files = await lightFiles(ctx, lifecycle); if (files instanceof Response) return fileFailure(files, true);
    const path = new URL(ctx.call.request.url).searchParams.get('path');
    if (!path) throw new Error('path is required');
    const uploaded: Array<{ path: string; bytes: Uint8Array }> = [];
    if (ctx.call.request.headers.get('content-type')?.startsWith('multipart/form-data')) {
      const form = await ctx.call.request.formData(), values = form.getAll('file');
      if (!values.length || !values.every(file => file instanceof File)) throw new Error('file is required');
      for (const file of values as File[]) uploaded.push({ path: values.length > 1 ? filePath(path, fileName(file.name)) : path, bytes: new Uint8Array(await file.arrayBuffer()) });
    } else uploaded.push({ path, bytes: new Uint8Array(await ctx.call.request.arrayBuffer()) });
    for (const file of uploaded) await files.write(file.path, file.bytes);
    return Response.json(uploaded.map(file => ({ path: file.path, name: fileName(file.path), type: 'file' })));
  } catch (error) { return fileFailure(error, true); }
}
