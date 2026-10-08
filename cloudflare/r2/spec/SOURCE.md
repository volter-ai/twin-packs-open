# R2 S3 wire provenance

Read 2026-09-30.

R2 publishes a compatibility reference instead of its own machine-readable S3 spec:
https://developers.cloudflare.com/r2/api/s3/api/ (updated 2026-07-31, read 2026-09-30).
The wire document is AWS's Smithy JSON AST `models/s3/service/2006-03-01/s3-2006-03-01.json`
at https://github.com/aws/api-models-aws commit `9b1a4929274443d8671ea8acfda7afbe856e29e9`.
`smithy.json.gz` is those vendor bytes compressed with gzip; SHA-256 of the uncompressed bytes:
`e632755547997bbfbde67d5630d6f09601c909ed9026713e5ff3f71887ab4892`.
Version `2006-03-01`, service `com.amazonaws.s3#AmazonS3`, protocol `aws.protocols#restXml`, auth `aws.auth#sigv4`.
The spec has 112 operations. The compatibility corrections select 69, of which 26 are listed implemented by R2.
Operations the reference does not mention remain in the denominator and answer the declared gap.

`patches.json` records every correction with its source. It removes the 43 model operations explicitly marked
unimplemented by R2, and drops 11 `x-id` URI literals where the ordinary S3 wire distinguishes requests through
required query/header parameters instead. `ListDirectoryBuckets` retains its discriminator because AWS sends
that operation to a different host; a bare R2 service request is `ListBuckets`.
AWS references are evidence for S3 request/response wire, not evidence that R2 supports an AWS-only feature.

R2-specific regions (`auto`, with empty/us-east-1 aliases), jurisdiction endpoints, token policies, unsupported
features and error forms are authored from Cloudflare's references in the manifest, state rules and semantics.
The new request hook uses the kernel's real SigV4 verification over actual bytes, including signed URLs.
The old placeholder-signature ruling is retired. Secret custody uses the kernel; the token id and SHA-256 of its
value become R2's S3 credentials as the vendor documents at https://developers.cloudflare.com/r2/api/tokens/.

The compatibility reference does not give a general unknown-operation response. The declared 501 NotImplemented
gap applies the error class Cloudflare documents for unsupported features in its release notes; that extension is
an explicit author ruling, not an observed upstream answer.

`doc-examples.json` contains published vendor requests rather than implementation. Its citations and replay
mapping are reread during construction; coverage and unreachable evidence are recorded only in the final walk.
No prior score or replay count establishes coverage of this replacement.


Dashboard OAuth facts were read from the published wrangler 4.143.0 SDK installed with twin-world's locked
dependencies (`wrangler-dist/cli.js`, scope catalog and OAuth callback/client constants), 2026-09-30. The production
client id is 54d11594-84e4-41aa-b438-e81b8fa78ee7, loopback callback path /oauth/callback, and PKCE method S256.
The published login guide is https://developers.cloudflare.com/workers/wrangler/commands/general/. The World's
explicit OAuth code lifetime is ten minutes and its access lifetime is exposed as one hour; these are deterministic
World policies where the vendor reference gives no fixed guarantee. Token values use World secret custody.
API-issued temporary S3 sessions are served; locally signed temporary JWT sessions and streaming checksum trailers
remain unserved wire features and refuse authentication/unsupported framing instead of granting parent access.

Screen references, read 2026-10-08: [Cloudflare's developer-platform changelog](https://developers.cloudflare.com/changelog/product-group/developer-platform/4/), its 2026-08-14 Worker screenshots, supplies the dashboard navigation. [Cloudflare's Workers/Pages convergence announcement](https://blog.cloudflare.com/pages-and-workers-are-converging-into-one-experience/), published 2023-05-16, supplies the historic application-list layout. The authored list shows stored Worker scripts and their actual domains; API-token dialogs perform the existing token operations. Additional navigation remains outside the declared screen scope. No upstream page or screenshot asset is shipped.
