// The World's phones (architecture, "Doors, screens and the gap"): an app installs on a device and registers for
// pushes (expo-notifications' getExpoPushTokenAsync, which Expo answers with a token for the app's project); the app
// is uninstalled; a phone's notifications are read back.
import type { HandlerContext } from '@volter/world-core';
import { DEVICE, deviceOf, NOTIFICATION, obj, type Row } from './shared.ts';

const bad = (message: string, status = 400): Response => Response.json({ message }, { status });

function invalidProject(): Response { return bad('project must be @owner/slug'); }
function invalidPlatform(): Response { return bad('platform must be ios or android'); }
function missingDevice(): Response { return bad('no device holds that token', 404); }
function alreadyUninstalled(): Response { return bad('the app is not installed', 409); }

/** An app installs on a phone: its Expo push token, `ExponentPushToken[` and 22 letters and digits, drawn from the
 *  World's secret. */
export async function devices(ctx: HandlerContext): Promise<Response> {
  const b = obj(ctx.body);
  // an Expo project is its owner and slug, `@owner/slug`
  if (typeof b.project !== 'string' || !/^@[\w-]+\/[\w-]+$/.test(b.project)) return invalidProject();
  if (!['ios', 'android'].includes(String(b.platform))) return invalidPlatform();
  const id = ctx.mint(DEVICE);
  const token = `ExponentPushToken[${(await ctx.secret(`expo-push-token:${id}`)).replace(/[^A-Za-z0-9]/g, '').slice(0, 22)}]`;
  await ctx.record(DEVICE, { token, project: b.project, platform: b.platform, owner: b.owner ?? null, status: 'installed', registration: 'registered' }, id);
  return Response.json({ token, project: b.project, platform: b.platform }, { status: 201 });
}

/** The app is uninstalled from the phone. */
export async function uninstall(ctx: HandlerContext): Promise<Response> {
  const d = deviceOf(ctx, decodeURIComponent(String(ctx.call.params.token)));
  if (!d) return missingDevice();
  const refused = ctx.legal(DEVICE, 'status', 'uninstall', d.status, 'uninstalled', String(d.id), 'external');
  if (refused) return alreadyUninstalled();
  await ctx.write(DEVICE, String(d.id), { status: 'uninstalled' }, 'uninstall');
  return Response.json({ token: d.token, installed: false });
}

/** What the phone shows: the notifications delivered to it, newest first. */
export async function inbox(ctx: HandlerContext): Promise<Response> {
  const d = deviceOf(ctx, decodeURIComponent(String(ctx.call.params.token)));
  if (!d) return missingDevice();
  const shown = ctx.rowsRaw(NOTIFICATION).slice().reverse().filter((n) => n._device === d.id && n._delivery === 'ok')
    .sort((a, z) => String(z._receipt_at).localeCompare(String(a._receipt_at)) || String(z._sent_at).localeCompare(String(a._sent_at)))
    .map((n) => ({ id: n.id, ...obj(n._message), to: n.to, received_at: n._receipt_at }));
  return Response.json({ data: shown });
}
