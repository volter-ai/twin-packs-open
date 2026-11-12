# @volter/twin-expo

Expo's push gateway for RH2's away notifier, with the served operations decided in
[journeys/demand.json](./journeys/demand.json) and [journeys/decisions.json](./journeys/decisions.json).
The Protocol 3 spec is authored from the vendor reference; [spec/SOURCE.md](./spec/SOURCE.md) records provenance.

`POST exp.host/--/api/v2/push/send` accepts a single message or a batch, expands recipient arrays in order,
and returns tickets. It refuses more than 100 notifications and mixed projects. Unknown or invalidated tokens
get DeviceNotRegistered tickets. Gzip requests use the kernel decoder.
`POST /--/api/v2/push/getReceipts` returns provider acceptance or delivery errors by ticket id, omits pending,
unknown and expired receipts, and refuses over 1000 ids. Receipts expire after 24 hours.

The World phones are `POST /_twin/devices` ({ project: "@owner/slug", platform: "ios" | "android", owner? }),
`POST /_twin/devices/{token}/uninstall`, and `GET /_twin/devices/{token}/notifications`.
The simulation assumes an online phone: provider acceptance at three seconds also displays its payload.
An uninstall is reported by the simulated provider on its next delivery; real providers can take an unspecified
time to report unregistration. An ok ticket or receipt alone is not proof of real device display.

Queues and phones are private World bookkeeping, with no vendor-backed account resources. Binding a real root
is refused: this pack does not deploy pushes to real devices. Enhanced push security, provider credentials,
provider downtime/rate faults, offline delivery, TTL scheduling and EAS build/release APIs are outside this scope.

Normal World routing is verified for RH2's global fetch caller. Imported Undici clients that bypass that rewrite
are refused by the World's socket backstop; this pack supplies no endpoint override for them. SDK dependency
adoption identifies the vendor when scanning an app; its connection path must still use the World's routing.
