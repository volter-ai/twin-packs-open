# VGAI auth source

Volter is the vendor. The public service is the Cloudflare Worker `vgai-auth`, custom domain auth.videogame.ai. It delegates identity and invitation delivery to Clerk and binds the separate vgai-managed-account ledger. It is not the Better Auth deployment at id.volter.ai.

Upstream: https://github.com/volter-ai/vgai-engine/tree/archive/launch-scope-2026-09-20/packages/vgai-auth . Source version 0.1.0. Read by Codex, 2026-10-03, from local git objects. Independent deployment review confirms the worker runs this archived tag. Its packages/vgai-auth tree is byte-identical to `8623e30886f72022df1bc623f9253efdba255860`; a local git diff over this package is empty. The archive tag, rather than the removal from main, identifies the deployed source.

The vendor publishes no OpenAPI. build-spec.ts records the pinned server dispatch and literal response shapes in openapi.json. The recordings are source snapshots, not API observations: worker-source.txt (worker.ts), deployment-source.txt (wrangler.toml), collaboration-handoff-source.txt (collaboration-handoff.ts), inference-grant-source.txt (inference-grant.ts), and invitation-rate-limit-source.txt (invitation-rate-limit.ts). No secret env or custody file was read or copied. Grouping is by source family. No spec patches. The proxy route declares all eight OpenAPI methods: worker.ts:111-112 routes it before the OPTIONS preflight without a method guard; worker.ts:279 clones the entire incoming request, including its method and body. Every proxy operation declares an optional opaque `string`/`binary` body under `*/*`, since the Worker preserves bytes regardless of their Content-Type label.

The deployment fixes `VGAI_ACCOUNT_CLIENT_ID` to `vgai-editor`; the door cannot override it. The editor’s `volter-editor` authorization gets 400. The deployed `VGAI_BILLING` binding is internal implementation of the public account projection. Its first-read account upsert and snapshot are modeled from the companion source; explicit billingBound=false retains the separate no-binding behavior. Public invitation delivery uses Clerk CreateInvitation with the source quota; explicit CLERK_API_URL selects the separate development 503. Unknown editor billing routes stay gaps outside the source dispatch.

The published accountToken source (`worker-source.txt:632-641`) forwards the provider status and body unchanged. The outer catch (`worker-source.txt:171-176`) returns 502 for a thrown error; a provider’s own 502 also passes through unchanged. `spec/doc-examples.json` contains no examples. The customer life registers a public PKCE client through Clerk’s own Backend API and obtains a real consent-issued code. Clerk’s [public-client documentation](https://clerk.com/docs/guides/configure/auth-strategies/oauth/how-clerk-implements-oauth#public-clients-and-pkce) says these clients exchange without a client secret; the worker sends its configured provider client ID.

Modeled account/share handoff values have no external decoder: editor account-service.ts:1233-1255 and collaboration-account-client.ts:68-151 carry them back to this Worker. They are stored as secret-derived opaque token rows; payload kind, PKCE, host/callback/invitation bindings and expiry remain source checks. Inference grants have a gateway decoder and remain unmodeled with ledger admission.

SHA-256 of the vendored bytes:

- `doc-examples.json` `37517e5f3dc66819f61f5a7bb8ace1921282415f10551d2defa5c3eb0985b570`
- `openapi.json` `16981712b744c8d685b9db751ff8a9d32916d2a3f20e81bbb020d5e7ffec7ea0`
- `grouping.json` `b643b964451fa5780111f92a2130dd4a11bdcb5ae0dd0f363f75de48edf3bf1b`
- `build-spec.ts` `878df66fd60d117001c19431467d4460ebe7db8f4fd017d7e850dc4af622ba86`
- `recordings/collaboration-handoff-source.txt` `43f8263482dc18a08b8db0c933533f53f273816e08b8d2c384f0b0b144dfc2d3`
- `recordings/deployment-source.txt` `568d580509ce12b243825f428284b1fb82f2e834997d46ceb5465ba6a73ae776`
- `recordings/inference-grant-source.txt` `2096e05568982b33ffb8c95a62889f6a3cd4eefa99fa6894ae6a42b5475ac910`
- `recordings/invitation-rate-limit-source.txt` `2323ac3c5e87538ad862032eef57ad9209733662af0bf7c3cf8effb5de6e92bd`
- `recordings/worker-source.txt` `a0e580dbf5f4e70304dc60f09cb9f89f9953d8071136fa5446b5dddfb9454172`

Managed account implementation at the same archive commit `d53f849b1ef086eaab8edb303f76b8cfe725389b`: `managed-account-app-source.txt` (packages/managed-account-service/src/app.ts), `managed-account-database-source.txt` (src/database.ts), `managed-account-worker-source.txt` (src/worker.ts), `managed-account-readme-source.txt` (README.md), and `managed-account-catalog-source.txt` (scripts/run-managed-services-dev.ts). Row creation is app.ts:201-214,633-638 and database.ts:363-388; snapshot fields app.ts:105-148 and defaults database.ts:168-191; admission worker-source.txt:198-250. Catalog values are required configuration, never inferred production secrets (README.md:68-75); the explicit World entry uses the published setup at catalog source:71-73. The Editor b86dde8c caller is packages/editor-core/server/account-service.ts:694.
- `recordings/managed-account-database-source.txt` `11c3d328063b49781b2ec0d1f8a7ef89c5827888ff0c77d788fc1f38174b31db`
- `recordings/managed-account-app-source.txt` `0381d6f23cba5b846a350623536fac1914f914990ba03db7cf6e2e85fef9236d`
- `recordings/managed-account-readme-source.txt` `c40934921431eebdc52b4d01aaaa836624b3c24aa8c7f5add0df841e93ffd74f`
- `recordings/managed-account-worker-source.txt` `69e23efb82239667fa2acbe0f808edad5c95cec65e98bd8c54a0df029ca24cd1`
- `recordings/managed-account-catalog-source.txt` `31d1a03806635ae43b0bd91d516786f7b110def784bb72d9a09322b588ee5f76`
