# Hugging Face Hub spec — provenance

- **File:** `openapi.json.gz`, gzip of the Hub's published OpenAPI document ("Hub API Endpoints" 0.0.1),
  https://huggingface.co/.well-known/openapi.json (fetched 2026-09-30). Served at https://huggingface.co.
- **SHA-256 of the uncompressed document:** `a5750c83e6560f7300f30748417dd721e1e317dd05c91b93b4470f5f80305057`.
- **Corrections:** `patches.json` restores the documented model repository information read and its `ModelInfo` shape. The reference’s slash-separated `repo_id` is represented by `{namespace}/{repo}` path parameters. The owner’s reviewed read-identity ruling supplies `_id` as the creation ObjectId. Its sources are the Hub’s own API reference at pinned hub-docs commit `4910c3c90009c5f906da11a89793bc9216f6ec7f` and the current HfApi client reference. The current Hub landing page has moved these endpoint descriptions to its playground; the pinned page still answers and contains the cited endpoint words. The document also omits the git-LFS batch endpoint (`/{namespace}/{repo}.git/info/lfs/objects/batch`),
  which is git-lfs's own protocol (https://github.com/git-lfs/git-lfs/blob/main/docs/api/batch.md).
- **Read by:** the pack author `/root`, 2026-10-01; derived by twin-world's `scripts/derive-pack.ts`.

Reference pages read for the modeled workflow and `doc-examples.json`:

- https://huggingface.co/docs/hub/api — links the published OpenAPI reference.
- https://huggingface.co/docs/hub/repositories-getting-started — Git publication and public model repositories.
- https://huggingface.co/docs/hub/security-tokens — token grants and Git Basic authentication.
- https://huggingface.co/docs/hub/rate-limits — Free user API quotas over five-minute windows; 200 per minute is the conservative one-fifth budget, not a separate vendor window.
- https://huggingface.co/docs/huggingface_hub/guides/repository — model creation examples and excluded dataset creation.
- https://huggingface.co/docs/huggingface_hub/guides/download — single-file main, branch, tag, PR and commit examples.
- https://huggingface.co/docs/huggingface_hub/package_reference/file_download — download URLs, content-derived ETags and missing-repository/revision/file errors.
- https://github.com/git-lfs/git-lfs/blob/main/docs/api/batch.md — basic LFS transfer.
- https://git-scm.com/docs/http-protocol — Git smart HTTP.
- https://www.rfc-editor.org/rfc/rfc9110 — Range, If-Range and unsatisfiable ranges.

The `doc-examples.json` requests translate the documented SDK call arguments to their Hub HTTP wire. Response samples only include fields the pages actually promise. The vendor's current getting-started guide recommends Git-Xet; this pack serves the measured HTTP download workflow and basic Git LFS fixture upload, not Xet reconstruction.


Read-back reference pages:

- https://raw.githubusercontent.com/huggingface/hub-docs/4910c3c90009c5f906da11a89793bc9216f6ec7f/docs/hub/api.md — GET /api/models/{repo_id} and the author-filtered model listing; immutable vendor documentation.
- https://huggingface.co/docs/huggingface_hub/package_reference/hf_api — model_info repo_id, authorization and ModelInfo fields.
