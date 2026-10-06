# Cloudflare: Kiln's year on Cloudflare

Author: Contributor 41. Written from the demand (journeys/demand.json), the
decision table (journeys/decisions.json) and Cloudflare's documentation; R2's published examples are walked apart, in
journeys/vendor-examples.json.

Kiln is a small studio that runs its products on Cloudflare: a site deployed as a Worker from a repository Open
Autonomy set up, R2 storage behind its link and media apps (the code paths of Dub, Postiz and RH2), its customers' own
domains served through Cloudflare for SaaS (Twenty's), and Turnstile on its sign-up and booking pages (Cal.com's,
Rallly's, LibreChat's). Mina owns the account. The story runs from January to December 2026 on the World clock.

The account and Mina's sign-in are the World's stand-ins for Cloudflare's sign-up (the `users` and `appCredentials`
doors); everything after is the API, the dashboard's pages or a browser, as each product sends it.

## Actors and their credentials

- **Mina**, the account's Super Administrator: her dashboard session (email and password) on My Profile's and R2's API
  Tokens pages.
- **The repository's deploy workflow** (wrangler, Open Autonomy's admin workflow): Mina's user API token
  `kiln-site-deploy` (Workers Scripts Write, Account Settings Read, User Details Read on Kiln's account), rolled in June.
- **Kiln's applications in the World** (the CRM, the link and media apps' servers, the Turnstile widget's setup and a
  vendor-backed World rooted at the account): the account's own token the credential door gives (R2 admin, Workers,
  Turnstile, Account API Tokens, zones and their certificates), and its R2 keys (the token's id and the SHA-256 of its
  value).
- **The media server** (LiveKit Egress, writing RH2's room recordings): the same R2 keys.
- **Jo**, Ana's colleague at Kiln (her browser), and **Ravi**, a contractor who set up the repository's workflow until June.
- **RH2**: an Object Read only R2 token confined to `kiln-recordings`, replaced in August.
- **Browsers** (Ana's and Jo's at Kiln, Ben's as a visitor booking): only presigned URLs, the public bucket domain and the
  Turnstile frame.
- **Twenty's webhook server**: receives Notifications, checking `cf-webhook-auth`.

## 1. A deploy token for the repository (Open Autonomy's setup)

Mina signs up; the World's application gets the account and its token. Open Autonomy's setup opens My Profile's API
Tokens page from its template URL (permissionGroupKeys as a URL-encoded JSON array: Workers Scripts edit, Account
Settings read, User Details read; the name `<project>-deploy`). Signed out, the dashboard sends her to the login page,
which shows its form; she logs in and is taken back. The form arrives pre-filled; she picks the account and creates the
token, shown once. The first paste misses characters and is refused (401, success false); setup stops. Mina corrects
the paste and setup verifies it (`user-api-tokens-verify-token`): active.

Screens: login, profile-api-tokens. Doors: users, appCredentials. Operations: user-api-tokens-verify-token.

## 2. The first deploy (wrangler deploy from the generated workflow)

The workflow runs wrangler deploy with the token and the account id. After the upload it installs the monthly sponsorship accrual Cron Trigger (`worker-cron-trigger-update-cron-triggers`) and the release operator reads that stored configuration back (`worker-cron-trigger-get-cron-triggers`). The deployed `workers.dev` address serves its uploaded static asset through the same asset rules as a Custom Domain. The account has no workers.dev subdomain yet
(`worker-subdomain-get-subdomain` 404), so Mina registers `kiln` (`worker-subdomain-create-subdomain`), as an owner does
before a first deploy. wrangler reads the script's latest deployment and its service: neither exists yet (404, which
wrangler takes as a first deploy). The site has static assets: an upload session over their manifest lists the hash to
send; an upload sent with the deploy token instead of the session's JWT is refused, and the file goes up with the JWT;
the completion token rides the module upload, with the R2 bucket binding. The script is then put on its workers.dev
route. The settings show the bindings.

Operations: worker-subdomain-get-subdomain, worker-subdomain-create-subdomain, worker-deployments-list-deployments,
worker-service-get, worker-script-update-create-assets-upload-session, worker-assets-upload,
worker-script-upload-worker-module, worker-script-get-subdomain, worker-script-post-subdomain, worker-script-get-settings,
r2-create-bucket (the bucket the Worker binds). Refusals: the subdomain, the deployment and the service not found; an
asset upload without the session's JWT.

## 3. Secrets, and a release with Durable Objects

The site release schedules a background tick once a minute. The deployment inventory reads it back. A later release reduces the tick to twice an hour; the inventory sees only that replacement schedule.

Operations: worker-cron-trigger-update-cron-triggers, worker-cron-trigger-get-cron-triggers.

Open Autonomy's admin workflow installs a mail key into the Worker (`worker-put-script-secret`); its text is never
answered back. A secret for a Worker that does not exist (a typo in the workflow's script name) is refused. A week later
the site's booking page gains two Durable Objects, `SlotHold` (holding a booking slot while a visitor pays) and
`VisitorCounter`: the release's deploy finds the latest deployment and the service (no migration tag yet), applies the
migration that makes both classes, and keeps the mail key. The release dashboard lists the Worker's two versions,
newest first.

Operations: worker-put-script-secret, worker-versions-list-versions. Refusal: the unknown script.

## 4. Storage for the apps (R2 credentials, buckets, CORS)

Kiln's link and media apps start in the World and are given the same account and token. On R2's API Tokens page Mina
makes an Object Read only token confined to the recordings bucket for RH2 (its Access Key ID and Secret Access Key shown
once). Through S3 the apps' buckets are made (`kiln-public`, `kiln-private`, `kiln-recordings`): listed, checked (a
misspelled name is not there), located. The public bucket takes a CORS rule for the app's origin, so browsers can PUT
to presigned URLs.

Screens: api-tokens. Door: appCredentials. Operations: CreateBucket, ListBuckets, HeadBucket, GetBucketLocation,
PutBucketCors, GetBucketCors.

## 5. A public domain for the media (Dub's and Postiz's public URLs)

Mina adds `kiln.media` as a zone (`zones-post`, pending, two nameservers assigned); her registrar publishes them (the
`dns` door). She first types the studio's old media domain, `media.kiln.studio`, which is no zone of the account:
refused. She attaches `assets.kiln.media` to `kiln-public` (`r2-add-custom-domain`, pending) and publishes its CNAME;
once Cloudflare has seen it, the World's router learns the host (the `hosts` door).

Operations: zones-post, r2-add-custom-domain. Doors: dns, hosts. Refusal: a domain of no zone of the account.

Mina also moves the studio's public website to `www.kiln.media`. Its old CNAME must be deleted before a
Worker Custom Domain can be attached. She reads the record and deletes it, then initially attaches the booking
Worker. The public brochure becomes a separate static Worker with home, about, journal, guide and download
pages. The release configures its service tags, logging and tail consumer and reads those settings back.
A launch hostname allows preparation before wrangler previews moving www from the booking Worker and
removing the launch origin. Mina approves the move; the inventory confirms the public domain and the retired
launch origin. A temporary review hostname is detached after approval. She follows the documentation's
dashboard link to Workers & Pages, finds both Workers and opens the brochure's domain.

The brochure carries redirects for old flyers, journal campaigns and team bookmarks, and a booking-host link.
One obsolete host-qualified source rule is ignored by the pinned parser, so that address shows the branded
404. Browser visits follow the exported page URLs, canonical redirects and review rewrite. The journal has
its own 404; another misspelling uses the site's root 404. A revisit revalidates the home page's ETag and a
download preview reads its metadata with HEAD. The header policy combines shared and section headers,
substitutes the article path and removes the default cache header.

Operations: DNS record create/list/delete, Worker read, zone routes list, R2 bucket read, Workers Domains
update/list/get/delete, domains changeset/records/get-record, script settings get/patch.

Evidence: [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
(existing CNAMEs prevent attachment and Workers & Pages opens the account's Workers);
[redirects](https://developers.cloudflare.com/workers/static-assets/redirects/),
[headers](https://developers.cloudflare.com/workers/static-assets/headers/),
[HTML handling](https://developers.cloudflare.com/workers/static-assets/routing/advanced/html-handling/),
and wrangler@4.137.0 `wrangler-dist/cli.js:158939-159040` (changeset, origin read and replacement),
`:162652-162666` (script settings). The DNS create answer's timestamps and proxy capability follow the
[record reference](https://developers.cloudflare.com/api/resources/dns/subresources/records/methods/create/)
and [proxy status](https://developers.cloudflare.com/dns/proxy-status/). The pinned SDK's `validateUrl`
refuses an absolute source URL when `onlyRelative` is true (`wrangler-dist/cli.js:170854-170892`);
the distinct guide file cannot redirect to a directory holding different bytes (asset worker `safeRedirect`).

## 6. Uploads, reads and deletes (Dub's storage, Postiz's simple uploads)

Dub uploads a logo to the public bucket with its type and length (`PutObject`), and pages load it at
`assets.kiln.media`. On the upload's notification it reads the object's head and its first bytes (`HeadObject`,
`GetObject` with a Range: 206); a misnamed key has no head. A browser uploads a flyer to a presigned PUT, after the CORS
preflight from the app's origin; Jo, Ana's colleague, uploading a second flyer from the page she bookmarked at the studio's old
address, `kiln.studio`, is refused at her browser's preflight, since the bucket's rule names only the app's origin. Postiz uploads a post's image with a plain PUT,
the AWS SDK adding its default CRC32 checksum, which R2 checks and answers back. An export is downloaded through a
presigned GET, which refuses once its ten minutes are past. The flyer is deleted and is gone (404).

Operations: PutObject, GetObject, HeadObject, DeleteObject. Refusals: the CORS preflight from another origin, the
expired presigned GET, the deleted key.

## 7. Videos (Postiz's multipart upload)

Postiz starts a multipart upload with the file's type and hash metadata, presigns the part URLs, and the browser PUTs
parts. Completing two small parts is refused (a non-final part under 5 MiB), so the upload is aborted, and its parts can
no longer be listed. A second upload of one part is listed and completed, and its first bytes are read back to sniff the
type; before it completes, the bucket's in-progress uploads hold it alone, the aborted one gone. Half an hour later Ana
starts a third, a long clip, and closes her browser after its first part: nobody aborts it, and R2's default rule for
every bucket aborts an upload seven days after it started.

Operations: CreateMultipartUpload, UploadPart, ListParts, ListMultipartUploads, CompleteMultipartUpload,
AbortMultipartUpload. Refusal: EntityTooSmall.

## 8. A recording import (RH2)

Kiln's operator configures the media server (LiveKit Egress) with the R2 keys; the first recording's upload is refused
because the secret was pasted with a character missing (SignatureDoesNotMatch). With the secret fixed, the media server
writes the recording into `kiln-recordings`. RH2 reads it with the Object Read token it holds for that bucket
(aws4fetch, path style), and the same token cannot read the public bucket.

Operations: PutObject, GetObject. Refusals: SignatureDoesNotMatch, AccessDenied outside the token's bucket.

## 9. Customers' own domains (Twenty's custom hostnames)

Kiln's operator first gives its CRM's server a Notifications webhook destination with the secret Twenty checks
(`notification-webhooks-create-a-webhook`) and a policy sending it the SSL for SaaS Custom Hostnames alert
(`notification-policies-create-a-notification-policy`); a policy naming a destination the account does not have (a
destination id copied from another account's docs) is refused. A customer asks for `crm.acme-studio.com`. The app finds
none and registers it (`custom-hostname-for-a-zone-create-custom-hostname`, ssl method txt): pending, with its ownership
and certificate validation records. The settings page finds it by hostname: pending, not yet CNAMEd to the zone. Acme's
admin asks to check again before publishing anything; the app refreshes its validation by sending its ssl again, and
the certificate stays pending validation with fresh records. The next morning the customer publishes the CNAME and the
TXT (the `dns` door); found again, the hostname and its certificate are active, and Cloudflare's Notifications have told
Twenty's server, the destination's secret in `cf-webhook-auth`, that the certificate was validated, issued and deployed
(the hostname at `data.data.hostname`, its zone at `data.metadata.zone.id`). Refreshing again changes nothing while
active.

Operations: notification webhook and policy create, custom-hostname list, create, edit. Doors: dns, deliveries.
Refusal: a policy naming no destination of the account.

## 10. Turnstile on sign-up and booking (Cal.com, Rallly, LibreChat)

In May the brochure generator adopts directory URLs. A new version changes HTML handling to force trailing
slashes, then a deployment sends it the traffic. Visitors' prior flat links and downloaded filenames redirect
to those directory URLs; the distinct guide download remains distinct from its directory index. A removed
page still shows Kiln's branded 404. These are visitors following the brochure's existing links after its
generator migration, rather than new content.

Mina makes a widget for `kiln.media` (`accounts-turnstile-widget-create`): its sitekey and secret. The sign-up page loads
api.js and renders the widget's frame; Ana passes it and the page gets her token. The server checks it at siteverify:
success, from `app.kiln.media`. Replayed, it is refused (timeout-or-duplicate). A copy of the page on a domain the widget
does not list cannot render it (110200). Ben's token, checked after he leaves the form open six minutes, is refused; a
server configured with a wrong secret is refused.

Screens: turnstile-api, turnstile-challenge, siteverify. Operations: accounts-turnstile-widget-create.

## 11. June: a contractor leaves, and a release renames a class

Ravi, the contractor who held the repository's deploy token while setting up its workflow, leaves on 1 June. Mina
rolls the token on My Profile's API Tokens page; the old value is refused at verify, the new one verifies, and she puts
it in the repository's environment. On 15 June a release renames the booking hold class to `BookingHold` and retires
the visitor counter (moved to analytics): wrangler reads the latest deployment and the service's migration tag (v1) and
uploads with the migration from v1 to v2.

Screen: profile-api-tokens (Roll). Operations: user-api-tokens-verify-token, worker-deployments-list-deployments,
worker-service-get, worker-script-update-create-assets-upload-session, worker-script-upload-worker-module. Refusal: the
rolled token's old value.

The June brochure redesign adopts extensionless URLs. Its release uploads a version with drop-trailing-slash
handling and deploys it at 100%. Existing home, about and journal bookmarks and exported filenames now
redirect to their extensionless canonical paths; the journal's removed page retains its own 404.

## 12. August: RH2's token leaks

On 10 August RH2's recordings token is pasted into a support chat by mistake. Mina revokes it on R2's API Tokens page
and makes a new Object Read only token for the recordings bucket; RH2's next import with the old key is refused
(Unauthorized), and with the new one it reads the recording.

Screen: api-tokens (Revoke, Create). Operation: GetObject. Refusal: the revoked key.

## 13. Autumn: a customer leaves, and the account is read back

In September Acme Studio leaves: the app deletes its hostname, which is no longer found, and Twenty's server is told its
certificate was deleted. A vendor-backed World rooted at Kiln's account then reads it back with the account's token:
the account and its active zone. For its tokens the inventory tool first tries the repository deploy token, which
lacks Account API Tokens; Mina supplies the account token and it reads the World's and RH2's new one, never their
values. It reads its Workers, the site's newest version whole, the Worker's
secrets by name, its Durable Object namespace (the renamed one alone), its workers.dev subdomain, its Notifications
destinations (the secret never shown) and policies, its Turnstile widget and its detail (the secret with it), its R2
buckets, the public bucket's custom domain, and the public bucket's in-progress uploads (none: the abandoned clip was
aborted). A person is not read back: the root's account token acts as no user.

Operations: custom-hostname-for-a-zone-delete-custom-hostname-(-and-any-issued-ssl-certificates), accounts-list-accounts,
zones-get, account-api-tokens-list-tokens, worker-script-list-workers, worker-versions-get-version-detail,
worker-list-script-secrets, durable-objects-namespace-list-namespaces, worker-subdomain-get-subdomain,
notification-webhooks-list-webhooks, notification-policies-list-notification-policies, accounts-turnstile-widgets-list,
accounts-turnstile-widget-get, r2-list-buckets, r2-list-custom-domains, ListMultipartUploads. Refusal: an account's
tokens to a token without the group.

The autumn brochure adds a browser-side catalog: its version disables HTML rewriting and uses the
single-page-application fallback, so a product URL loads the actual exported home shell. Literal HTML downloads
remain available. At the end of November Mina closes that catalog and publishes a winter archive containing
the literal home and about files, without a client-route fallback or a 404 template. An old catalog bookmark
then returns 404 while the about download still works. Each configuration change is uploaded as a version and
only takes effect when a deployment gives it the traffic.

Evidence: [HTML handling](https://developers.cloudflare.com/workers/static-assets/routing/advanced/html-handling/),
[static-site routing](https://developers.cloudflare.com/workers/static-assets/routing/static-site-generation/),
[SPA routing](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/),
and spec operations `worker-versions-upload-version` and `worker-deployments-create-deployment`.

## 14. December: the old public bucket closes

Kiln moves its media to a new store. The move tool first lists the public bucket's top level by "/" (the `logos/` folder
and the files beside it), then copies in batches of two keys, following the continuation token the first batch ends
with. The bucket's delete is refused while it still holds objects; each object is deleted, and the empty bucket (and
its public domain) is removed.

Operations: ListObjectsV2, DeleteObject, DeleteBucket. Refusal: BucketNotEmpty.

The release operator refuses an out-of-range minute, a zero weekday and newline-separated cron fields; the installed monthly trigger remains readable after all three refused replacements.

The May booking build is staged for review: an upload adapter first loses metadata, then serializes it as a list, then loses the entry-point name and its file. Each refused version leaves the two deployed builds alone. Its repaired multipart sends the code-bearing Worker's actual module, stages a third version, and Mina reads its compatibility date; June's migration rebuild becomes the fourth. The separate assets-only brochure follows Wrangler's metadata-only branch (the sourced spec correction), while a release adapter missing its required deployment strategy is refused before retry. The DNS cutover also reads the predecessor by id and checks that create, list and detail answers omit the stored zone_id.
The upload audit also checks the manifest file hash and size, a binding's required bucket name in both script and version uploads, and each deployment version's percentage before the repaired release changes traffic.

During the website cutover, the DNS import confuses milliseconds with TTL seconds and provides an MX priority of 65536. Cloudflare refuses both before creating records; Mina publishes the corrected priority zero, one-hour mail record and the automatic-TTL CNAME. In May, the booking rollout adapter proposes -1/101 weights, then a 0.001 percent canary. Both are refused; Mina reads back the unchanged production deployment before the brochure release continues.
