// What every family of envd shares: the vendor's (../../../src/semantics/shared.ts), its stored shapes and the
// vendor's answers.
export * from '../../../src/semantics/shared.ts';
export { manifest as lifecycle } from '../../../api/src/manifest.ts';
import type { HandlerContext, MachineFiles, DerivedManifest } from '@volter/world-core';
import { liveSandbox } from '../../../src/semantics/shared.ts';

export const fileName = (path: string): string => path.replace(/\/+$/, '').split('/').at(-1) ?? '';
export const filePath = (base: string, name: string): string => `${base.replace(/\/+$/, '')}/${name.replace(/^\/+/, '')}`;

/** envd's REST errors use integer codes; Connect errors use their protocol's string names. */
// source: spec:/components/schemas/Error "Error code"
export async function fileFailure(error: unknown, rest: boolean): Promise<Response> {
  if (error instanceof Response) {
    if (!rest) return error;
    const body = await error.json().catch(() => ({ message: error.statusText })) as { message?: string };
    const headers = new Headers(error.headers); headers.delete('content-length'); headers.set('content-type', 'application/json');
    return Response.json({ code: error.status, message: body.message ?? error.statusText }, { status: error.status, headers });
  }
  const message = String((error as Error).message ?? error);
  const status = /ENOENT|\b404\b|not found|could not find|does not exist|no such/i.test(message) ? 404 : /EACCES|EPERM|permission denied/i.test(message) ? 403 : /ENOSPC/i.test(message) ? 507 : 400;
  // source: spec:/components/responses/FileNotFound "File not found"
  // source: spec:/components/responses/InternalServerError "permission denied"
  const httpStatus = rest && status === 403 ? 500 : status;
  return Response.json({ code: rest ? httpStatus : status === 404 ? 'not_found' : status === 403 ? 'permission_denied' : status === 507 ? 'resource_exhausted' : 'invalid_argument', message }, { status: httpStatus });
}

/** Only the pack knows that its files service is envd; the runner exposes an ordinary files surface. */
export async function lightFiles(ctx: HandlerContext, lifecycle: DerivedManifest): Promise<MachineFiles | Response> {
  const sb = await liveSandbox(ctx, lifecycle);
  if (sb instanceof Response) return sb;
  return ctx.machines.files(String(ctx.call.params.sandboxID ?? ''));
}

// source: spec:Filesystem.Stat "Stat"
export async function filesystemEntry(files: MachineFiles, path: string): Promise<Record<string, unknown>> {
  const info = await files.stat(path);
  return { name: fileName(path), path, type: info.type === 'directory' ? 'FILE_TYPE_DIRECTORY' : 'FILE_TYPE_FILE', size: String(info.size), mode: info.mode, permissions: (info.mode & 0o777).toString(8), modifiedTime: info.mtime };
}
