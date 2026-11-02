# aws/secretsmanager spec — provenance

- **File:** `smithy.json.gz`, gzip of the public sample-transformed projection of AWS's published Smithy JSON AST for AWS Secrets Manager.
- **Upstream:** https://github.com/aws/api-models-aws, `models/secrets-manager/service/2017-10-17/secrets-manager-2017-10-17.json`;
  original private capture vendored 2026-09-24, and checked 2026-09-29 byte for byte against that path at commit
  `9b1a4929274443d8671ea8acfda7afbe856e29e9` (the S3 lane's) and at `main`.
- **Spec version:** `2017-10-17` (`com.amazonaws.secretsmanager#secretsmanager`); protocol `aws.protocols#awsJson1_1`,
  auth `aws.auth#sigv4`.
- **SHA-256 of the original upstream uncompressed document:** `2738bd8ded2b25834c71089cf71232738972d78befa80fa168ea476978ac8604`.
- **SHA-256 of the original private captured bytes:** `smithy.json.gz` `56c0c870fd6b6ab92110cbc12daa4cae08dbe8016f231ed3c15418b57de02b0a`.
- **Wire-schema corrections:** none. This public projection transforms example resource identifiers and a documented request/version identifier as described below.
- **Published examples beside the model:** `doc-examples.json`, copied from Secrets Manager's pages as their rendered
  text reads: the rotation schedule page's schedules and rules (rotate-secrets_schedule.html), and the rules
  API_PutSecretValue.html, API_UpdateSecret.html, API_DeleteSecret.html, API_ReplicateSecretToRegions.html,
  API_GetSecretValue.html, API_RotateSecret.html, API_GetRandomPassword.html, API_ListSecrets.html,
  API_BatchGetSecretValue.html and API_ListSecretVersionIds.html state.
- **Read by:** `bun <twin-world>/scripts/derive-pack.ts <this lane>`; the twin orchestrator, 2026-09-29.

## Public sample transformation

Only static fixture identifiers are substituted. The original captured bytes and their upstream identities remain private and unchanged. The public Smithy examples retain their original structural forms; the substitutions affect the three `BatchGetSecretValue` example ARN fields and the `ReplicateSecretToRegions` example ARN field. The accompanying `GetSecretValue` version-selection documentation example and merged AWS journey references use the same transformed request/version identifier. Journey request/version UUIDs and rotation resource labels are synthetic, and their request, capture and expectation references remain consistent. Public journeys identify themselves as transformed fixtures.

- **Public transformed Smithy SHA-256, expanded:** `c615e735f82852bf46b312957ac7b3da2c812538a3974751e2a94ec46593d744`.
- **Public transformed Smithy SHA-256, gzip:** `bce3a672c67b38093ca2f8012b0f97854c361c64bf3ebc08ae45952a83decebc`.
- **Original private documentation-examples SHA-256:** `691f6000563c0127b7e6e01e760adbc906b342bbb19e0fc37b99e9604dc93040`.
- **Public transformed documentation-examples SHA-256:** `5027b8f9a5264d160cf6f37edc628c88255a5678cee030955379a1c2c85ed9f6`.
