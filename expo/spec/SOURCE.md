# Expo push notification service

- **Why this document:** Expo publishes no OpenAPI document of its push service. This one is written from its
  reference page, https://docs.expo.dev/push-notifications/sending-notifications/ (fetched 2026-09-30): the send
  endpoint (a message or an array of up to 100, the message request format), push tickets, the receipts endpoint (up
  to 1000 ids), and the errors. EAS (api.expo.dev) is not in it: no application of the World calls it at run time.
- **Its host:** exp.host.
- **Corrections:** patches.json removes the erroneous sound object alternatives; the reference specifies string or null. Original bytes are preserved.
- **Read by:** the twin orchestrator, 2026-09-30.
- **Vendored bytes (sha256):** `openapi.json` `96f1f4b2be6c1144919322e8df7ae0821c11cc1136e232af40de15eef538af0f`.

- **Examples:** `doc-examples.json` transcribes the send/receipt reference examples and request-limit, invalid-payload, provider-error and receipt-retention rules from the same page (read 2026-10-01 by /root). Schema-format pseudocode (`string[]`, union placeholders) is a format illustration, represented by the concrete examples rather than invalid JSON. Provider rate/credential faults and enhanced-security authorization are outside the modeled online/no-security provider configuration.

- **Placeholder ids:** doc-examples.json explicitly declares the reference's illustrative ExpoPushToken and receipt UUID strings. Actual tokens and ticket ids are captured from the World. Retention-rule input uses two expired tickets; the reference states the retention rule without a concrete request fixture.
- **Remaining rules:** every source-linked provider/configuration, native presentation and network-diagnostic exclusion is inventoried in doc-examples.json and journeys/vendor-examples.json, rather than silently omitted.
