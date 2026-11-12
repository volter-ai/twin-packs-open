# Daily customer life

Author: Codex pack builder.

No demanded application calls Daily; Cal.com enables daily-video only with the operator-supplied DAILY_API_KEY and valid enabled app keys. DAILY_API_KEY ships empty.

Cal.com (`calcom/cal.diy` at `54343aa685ae8f33159d2f485ec4a57bad5c574a`)
leaves `DAILY_API_KEY` empty in `.env.appStore.example:39`. The app-store seed
checks it at `scripts/seed-app-store.ts:148`; booking fallback requires enabled
Daily and valid keys at `packages/features/bookings/lib/EventManager.ts:298–310`.
The optional integration's call sites remain in `demand.json`.

There are no demanded customer acts, credentials, room screens, events or stored
state. Every spec operation answers the vendor-shaped gap. Published examples
remain in the spec and count as unserved; the life has no steps.
