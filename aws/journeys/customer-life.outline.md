# Larkspur on AWS: the outline

Author: Contributor 82 (the aws pack builder). Written from the re-read demand (journeys/demand.json), the decision
table (journeys/decisions.json) and AWS's documentation; Secrets Manager's published examples are walked apart, in
journeys/vendor-examples.json.

**Customer.** Larkspur, a twelve-person scheduling SaaS on AWS in us-east-1. People and programs acting for it: Dana
(platform engineer, owns the account, its buckets and its secrets), Sam (on-call engineer), Priya (sales lead, works in
the CRM), the API service (reads its database credentials at boot), a nightly billing cron job (reads the Stripe key),
CI (deploys, writes nothing to secrets). Larkspur's files live in S3, written by applications it runs unchanged after configuring their opt-in S3 storage (LibreChat fileStrategy=s3, Twenty STORAGE_TYPE=s3, Rallly’s S3 credentials), each
with the access key the World issues it at boot (the credential door): the twin platform it runs for its integration
tests, which backs its state up to S3 every night (twin-world apps/platform/src/backup.ts); its CRM, a self-hosted
Twenty; its team's LibreChat; and its team's Rallly for meeting polls. The World clock starts 2026-01-01; the life
spans about eighteen months.

**Who signs with what.** Those four applications share the one access key issued for them, an IAM user's. Dana and Sam
each sign with their own IAM user's key (dana, sam), the platform team's. Every service Larkspur runs on AWS signs as
its own role, with the temporary credentials of a session STS gives it each time it starts: each API boot, the cache
worker's first boot, each billing and report run, each rotation the function is invoked for (its set and finish steps
keep that invocation's session), and the drill app's start. The API service is larkspur-api, the cache
worker larkspur-cache-worker, the billing job larkspur-billing-job and the revenue report script larkspur-report-script.
The rotation function is larkspur-db-rotation-role, from June, in a session named for the function, and the us-west-2
DR app is larkspur-dr-app. The roles a resource policy names below are therefore the principals that read.

1. **Monday 5 January: the account's buckets.** The applications' key and Dana's and Sam's keys are issued. Dana makes the buckets for
   Twenty, LibreChat and Rallly and lists the account's buckets.
2. **Tuesday 6 January, 02:00: the first nightly backup.** The platform's backup job finds its bucket missing
   (HeadBucket 404), makes it, and puts the night's archive.
3. **Tuesday 6 January: moving secrets out of environment files.** Dana stores the production database credentials as
   a JSON secret, tagged with the team and environment. Her CLI times out and retries with the same client request
   token, which Secrets Manager treats as the same request. The API service reads the secret at boot. Dana stores the
   Stripe secret key the billing job needs.
4. **Wednesday 7 January: the second backup, and a restore.** At 02:00 the job checks its bucket (there now) and puts
   the next archive. At 09:30 an operator lists the archives kept (two) and restores the first after a bad migration
   in the test platform.
5. **Thursday 8 January: Rallly.** Rallly's S3 settings carry a typo in the bucket name, so Sam's first avatar upload is
   refused (NoSuchBucket); Dana fixes the setting. Sam's avatar goes up through Rallly's own upload route and his
   profile shows it through Rallly's storage route. He replaces it: the new one goes up and Rallly deletes the old one;
   a page still holding the old link gets NoSuchKey.
6. **Monday 12 January: Twenty.** Priya uploads a prospect's logo from her browser, which PUTs it to the presigned
   upload URL Twenty gives it. Its preflight is refused: the bucket has no CORS rules. Dana adds a rule for the CRM's
   origin (PUT and GET, any header), and the preflight now passes. The presigned URL signs the logo's type and length,
   as Twenty's upload target makes it. The upload lands under Twenty's pending prefix and Twenty moves it to the
   company's folder (copy, then delete). Twenty stores a contract from its server, and Dana's sandbox workspace holds an
   imported file and an attachment. Priya opens the contract through a presigned link that names its content type,
   disposition and caching. Each file is one of its type: a PNG, a one-page PDF.
7. **Tuesday 13 January: LibreChat.** A person attaches a PDF; LibreChat stores it and gives a one-hour presigned
   download link naming the file as an attachment; two hours later the link has expired. A call recording goes up as
   a one-part multipart upload (an M4A) and is streamed to the person. The person
   deletes the PDF: LibreChat checks it is there, then deletes it. Ten minutes later a second browser tab that still
   lists the PDF deletes it again: LibreChat's check finds it gone.
8. **Monday 2 February: the sandbox workspace removed.** Dana opens the bucket in the S3 console, which lists it one
   folder level at a time: the CRM's workspace and her sandbox's. She deletes the sandbox workspace in Twenty, which
   lists its folder and deletes its files in one request.
9. **February: the cache arrives.** The team adds Redis; Dana stores its auth token as a secret before the worker that
   reads it is deployed, and the worker reads it on its first boot.
10. **March: first manual rotation.** A contractor who knew the database password leaves. Dana asks Secrets Manager for
    a random password without punctuation (the database driver mishandles it), stores it as a new version staged
    AWSPENDING, sets it on the database, checks a login with it, and at once moves AWSCURRENT to the new version, which
    makes the old one AWSPREVIOUS; AWSPENDING stays on the new version, as a finished rotation may leave it. The API
    service picks up the new password on its next boot.
11. **April: locking it down.** Dana writes a resource policy for the database secret that denies reading its value
    (GetSecretValue) to every principal but the API service's role; managing the secret stays with the platform team's
    IAM permissions, so Dana and Sam keep working on it. She validates it; her first draft has a malformed role ARN
    (the account id is missing) and validation reports it; she fixes it, validates again and attaches it.
12. **June: automatic rotation.** Dana deploys the rotation function from AWS's template, which creates its role; she
    adds that role to the policy's readers (the function must read and write the secret), then turns on rotation every
    90 days (the database team's policy) and reads the secret's details to confirm the schedule. Each quarter from then
    on the function carries out the rotation Secrets Manager invokes it for, the first in its first session of the role. Each time, as the template does, it looks
    for a value under the pending version before making one, and finds none. The API service keeps reading
    AWSCURRENT; each quarterly review sees the last rotation.
13. **September: disaster recovery.** An enterprise customer's contract requires cross-region DR. Dana adds the
    us-west-2 DR app's role to the policy's readers, replicates the database secret to us-west-2 (the replica carries
    the policy) and checks the replica's status there.
14. **November: a DR drill.** Sam promotes the us-west-2 replica to a standalone secret, as the runbook says, and the
    drill's app in us-west-2 starts in a session of larkspur-dr-app and reads it. After the drill Dana deletes the promoted copy without a recovery window (it was
    a drill copy); the next day, once the deletion has finished, she replicates the primary to us-west-2 again.
15. **January 2027: retiring the old Stripe key.** Billing moves to a restricted key; Dana stores it, points the billing
    job at it, and schedules the old key for deletion with a 30-day recovery window. A forgotten report script still
    reads the old key the next morning and is refused because the secret is scheduled for deletion; Dana restores it,
    fixes the script to use the new key that week, and schedules the deletion again. After the window passes the old
    key is gone.
16. **Throughout: audits.** Each quarter Dana lists the production secrets by tag for the security review; the list
    shows when each was last rotated. The reviews are separated by waits.
17. **June 2027: leaving.** Larkspur is acquired and moves to the acquirer's vault. Once the migration is verified, Dana
    removes the us-west-2 replica (a replicated primary cannot be deleted) and deletes every secret without a recovery
    window.

Operations: CreateBucket, HeadBucket, ListBuckets, PutBucketCors, PutObject (from a server and through a presigned
URL), GetObject (from a server and through presigned URLs with response overrides), HeadObject, CopyObject,
DeleteObject, DeleteObjects, ListObjectsV2, CreateMultipartUpload, UploadPart, CompleteMultipartUpload,
every Secrets Manager operation the lane serves. Doors: appCredentials (the applications' key, a person's key, a
role's session), rotationInvocations. Refusals: NoSuchBucket, NoSuchKey, a CORS preflight to a bucket with no rules, an
expired presigned link; Secrets Manager's as in acts 11 and 15.
