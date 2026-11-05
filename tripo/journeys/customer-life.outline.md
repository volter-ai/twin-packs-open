# Tripo: artists connect their accounts

Author: Contributor 92

The editor at b86dde8c56186c75ee954619004527f5e1050277 tests a connected Tripo key with its balance request (packages/editor-core/server/provider-credentials.ts:37-40). test() rejects absent keys locally (line 311), failed HTTP status (318-319) and a JSON code other than zero (321-323). The story follows that Account settings integration. The World account door stands in for account creation, credit allocation and API-key issuance on Tripo's platform, which the declared SDK API cannot perform.

1. **Prepare the accounts.** Supply an artist's credited account through POST /_twin/accounts and capture its key; supply a colleague's new account without allocated credits and capture their separate key. These are setup fixtures for the two people's connections.
2. **Connect in Account settings.** Each artist connects their own key. The editor sends GET /v2/openapi/user/balance with Bearer and Content-Type: application/json, as line 37 sends it. The first account has 3000 available credits, the new account zero; both have zero frozen. The captured keys address their own accounts.
3. **A later paste mistake.** A day later the artist mistypes their credential when reconnecting. The same editor request gets the recorded authentication refusal. Copying the issued key correctly restores the successful connection test.

No separate raw HTTP integration is in this demand. The editor sends no request when no key is configured. No generation, upload, polling or segmentation request belongs to these acts. The declared spec retains those operations as gaps.
