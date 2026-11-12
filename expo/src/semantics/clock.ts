// Expo's own move as the World clock passes (docs/contributing/architecture.md, clock.ts): a received notification is
// handed to FCM or APNs a few seconds after it was sent, and its receipt made: ok, and the phone shows it; or
// DeviceNotRegistered when the app is no longer installed (Expo then knows the token reaches nothing); or
// MessageTooBig when its payload is over 4096 bytes.
// Where the documentation stops: "Most notifications are typically delivered within a few seconds"; the three seconds
// are the twin's.
import type { HandlerContext } from '@volter/world-core';
import { DEVICE, NOTIFICATION, PAYLOAD_LIMIT, payloadBytes, obj } from './shared.ts';

const DELIVERY_MS = 3_000;

export async function clock(ctx: HandlerContext): Promise<void> {
  const now = Date.parse(ctx.occurredAt);
  for (const n of ctx.rowsRaw(NOTIFICATION).filter((x) => x._delivery === 'queued' && x.deleted !== true)) {
    const due = Date.parse(String(n._sent_at)) + DELIVERY_MS;
    if (due > now) continue;
    const then = await ctx.at(new Date(due).toISOString());
    const device = then.row(DEVICE, String(n._device));
    const receipt = { _receipt_at: then.occurredAt };
    // the delivery's move, asked of its machine as the vendor's
    const outcome = !device || device.status !== 'installed' || payloadBytes(obj(n._message)) > PAYLOAD_LIMIT ? 'error' : 'ok';
    const refused = then.legal(NOTIFICATION, '_delivery', 'notification.receipt', 'queued', outcome, String(n.id), 'vendor');
    if (refused) throw new Error(refused.message);
    if (!device || device.status !== 'installed') {
      // source: https://docs.expo.dev/push-notifications/sending-notifications/ "The device cannot receive push notifications anymore"
      await then.write(NOTIFICATION, String(n.id), { ...receipt, _delivery: 'error', _receipt_error: 'DeviceNotRegistered', _receipt_message: `"${String(n.to)}" is not a registered push notification recipient` }, 'notification.receipt');
      if (device && device.registration === 'registered' && !then.legal(DEVICE, 'registration', 'notification.receipt', 'registered', 'unregistered', String(device.id), 'vendor')) {
        await then.write(DEVICE, String(device.id), { registration: 'unregistered' }, 'notification.receipt');
      }
    } else if (payloadBytes(obj(n._message)) > PAYLOAD_LIMIT) {
      // source: https://docs.expo.dev/push-notifications/sending-notifications/ "The total notification payload was too large."
      await then.write(NOTIFICATION, String(n.id), { ...receipt, _delivery: 'error', _receipt_error: 'MessageTooBig', _receipt_message: 'Message too big' }, 'notification.receipt');
    } else {
      await then.write(NOTIFICATION, String(n.id), { ...receipt, _delivery: 'ok' }, 'notification.receipt');
    }
  }
}
