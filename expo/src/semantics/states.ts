// Expo's push delivery (architecture, "State"): a notification Expo received waits to be handed to FCM or APNs; the
// vendor's own move (semantics/clock.ts) makes its receipt, ok or an error. Nothing a caller asks moves it.
import type { StateField } from '@volter/world-core';

const PUSH = 'https://docs.expo.dev/push-notifications/sending-notifications/';

/** A notification's delivery, hidden from the API until its receipt exists (the receipt's `status` is its view). */
export const delivery: StateField = {
  initial: 'queued',
  transitions: [
    { actor: 'vendor', from: ['queued'], to: 'ok', source: `${PUSH} "Once Expo delivers a notification to the Android or iOS push notification service, Expo creates a push receipt"` },
    { actor: 'vendor', from: ['queued'], to: 'error', source: `${PUSH} "If there was an error in delivering the notification"` },
  ],
};

/** An app on a phone: installed until the person uninstalls it (the World's door: the person's move, outside the API). */
export const installation: StateField = {
  initial: 'installed',
  transitions: [
    { actor: 'external', from: ['installed'], to: 'uninstalled', source: `${PUSH} "The device cannot receive push notifications anymore"` },
    { actor: 'external', from: ['uninstalled'], refusal: { status: 409, message: 'the app is not installed' }, source: `${PUSH} "The device cannot receive push notifications anymore"` },
  ],
};

/** A push token as Expo knows it: registered until a delivery learns the app is gone (DeviceNotRegistered), after
 *  which a send to it is an error ticket. */
export const registration: StateField = {
  initial: 'registered',
  transitions: [
    { actor: 'vendor', from: ['registered'], to: 'unregistered', source: `${PUSH} "you should stop sending messages to the corresponding Expo push token"` },
  ],
};

export const states = {
  _notification: { state: { _delivery: delivery } },
  _device: { state: { status: installation, registration } },
};
