# A publisher moves a small archive to Dub

Author: Bitly contributor (Codex).

1. Account setup: a publisher opens a synthetic account through `door:signup`, receiving its initial group,
   generic token and Dub app credentials. The signup fixture supplies no links. The group has the synthetic
   account's existing branded domain. The customer publishes a 101-article catalog with its automated publisher with `createFullBitlink`.
2. A later campaign: after a day the publisher archives the outdated first article
   with `updateBitlink`. The account retains the other 100 links. Archiving only removes it from default lists.
3. Connect Dub: after another day the customer reaches Bitly's `screen:authorize`, signs in as that account,
   and authorizes the registered Dub redirect. Dub exchanges the returned code with `exchangeAccessToken`
   using its real form body and reads the form-encoded access token.
4. Import: Dub lists `getGroups`, reads `getGroupTags`, checks `getPlatformLimits`, restores the useful archived citation at the publisher's request, then imports
   `getBitlinksByGroup` using a frozen cutoff and the returned cursor until the last page. A legacy visitor
   asks `getBitlink` for a stored link using the generic account key, as Dub's middleware does.
5. A changed connection: another day passes. A user enters an invalid token and receives the documented
   `FORBIDDEN` response. Correcting the original account token succeeds. A stale link request is `NOT_FOUND`; links retained by the account still import.

The life ends with the archive available for vendor-backed refresh. It does not construct unsupported
campaigns, QR codes, billing records, password grants or webhooks.
