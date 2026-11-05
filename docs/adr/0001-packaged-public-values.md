# ADR 0001: Packaged values are classified by provenance

Status: accepted.

## Decision

A value is a secret by where it came from, not by its shape. Package source owns its authored bytes; the release sweep owns the decision to accept an exact public upstream value. Runtime recording redaction does not alter package source, specifications, fixtures or vendored code.

Author-controlled fixtures, examples, journeys, generated data and snapshots of our own private repository source use visibly inert values by construction, in a clearly non-secret namespace. Values retain the vendor's grammar, uniqueness requirements and relationships across setup, requests, assertions and readbacks. Private source snapshots preserve their behavior-bearing constants and use inert credential examples. These authored bytes are corrected at source and never placed in sweep binding data, including when a private source snapshot is byte-identical to its origin.

Pinned upstream documentation samples may be replaced with inert examples. Each replacement is recorded in the owning `SOURCE.md`, with its source location, original upstream hash, packaged hash and replacement. The original input is retained outside the published package. Unchanged source data and the relationships between sample values remain intact.

Executable code and public identifiers from publicly published upstream releases retain their upstream semantics when shipped byte-identical. A sweep binding for these bytes names the upstream release URL and version, upstream file hash, shipped package and exact path and file hash, exact value, and the one gitleaks rule it trips. The sweep verifies these guards before constructing native, rule-targeted exact-file/exact-value AND allowlists and verifies shipped bytes again after scanning. It scans every unbound byte normally. A binding never accepts an entire file or package and never applies to author-controlled content, custody values or Teams tokens. Custody and Teams scans always refuse a match, including in bound files.

The sweep implementation and binding data belong to supercode's existing `scripts/npm-keys-sweep.mjs` owner and require independent source review. Release preparation pins its merged commit. Package-specific scanners, entropy-wide exclusions, response rewriting and relaxed qualification are forbidden. Each upload still requires a clean sweep of the exact archive and manager permission for its source and bytes.

## Consequences

Shape detectors remain conservative without changing legitimate upstream executable constants. A changed upstream or shipped hash fails closed and needs a reviewed binding update; a new value or a different rule is unbound and scanned normally. Public documentation samples remain traceable to their retained originals.
