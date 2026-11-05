# aws/secretsmanager spec — provenance

- **File:** `smithy.json.gz`, gzip of AWS's published Smithy JSON AST for AWS Secrets Manager.
- **Upstream:** https://github.com/aws/api-models-aws, `models/secrets-manager/service/2017-10-17/secrets-manager-2017-10-17.json`;
  vendored 2026-09-24, and checked 2026-09-29 byte for byte against that path at commit
  `9b1a4929274443d8671ea8acfda7afbe856e29e9` (the S3 lane's) and at `main`.
- **Spec version:** `2017-10-17` (`com.amazonaws.secretsmanager#secretsmanager`); protocol `aws.protocols#awsJson1_1`,
  auth `aws.auth#sigv4`.
- **SHA-256 of the uncompressed document:** `2738bd8ded2b25834c71089cf71232738972d78befa80fa168ea476978ac8604`.
- **SHA-256 of the vendored bytes:** `smithy.json.gz` `56c0c870fd6b6ab92110cbc12daa4cae08dbe8016f231ed3c15418b57de02b0a`.
- **Corrections:** none.
- **Published examples beside the model:** `doc-examples.json`, copied from Secrets Manager's pages as their rendered
  text reads: the rotation schedule page's schedules and rules (rotate-secrets_schedule.html), and the rules
  API_PutSecretValue.html, API_UpdateSecret.html, API_DeleteSecret.html, API_ReplicateSecretToRegions.html,
  API_GetSecretValue.html, API_RotateSecret.html, API_GetRandomPassword.html, API_ListSecrets.html,
  API_BatchGetSecretValue.html and API_ListSecretVersionIds.html state.
- **Read by:** `bun <twin-world>/scripts/derive-pack.ts <this lane>`; the twin orchestrator, 2026-09-29.

## Packaged documentation samples

- **Source:** https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_GetSecretValue.html; `doc-examples.json` entry 37, `GetSecretValue`.
- **Retained original:** `/Volumes/PeakSSD/peak-floor/state/prod-ops/releases/vo3818-source-captures/aws/secretsmanager-doc-examples.upstream.json`; SHA-256 `691f6000563c0127b7e6e01e760adbc906b342bbb19e0fc37b99e9604dc93040`.
- **Packaged file:** `doc-examples.json`; SHA-256 `3ae9ae05011194f6efb628c83b5c1125a90fb7ee7081fa167731556e816ecd47`.
- The published version identifier is an inert UUID in the packaged documentation and the journey that creates and reads that version. All other documentation bytes and values remain unchanged.

| JSON pointer | Packaged replacement |
|---|---|
| `/37/input/VersionId` | `00000000-0000-4000-8000-000000000007` |
