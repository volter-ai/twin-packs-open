# @volter/twin-googleoauth

The googleoauth twin (Protocol 3). Its surface is derived from the vendor's spec (`spec/`, provenance in
`spec/SOURCE.md`); what it serves and why is its manifest and semantics.

Rules, layout and tools: twin-world's architecture ("Protocol 3", "The catalog: where twins come from").

The package exports `googleSubFor(email)` as the native Google account-id contract used by Google API twins. It lowercases the email, hashes `"google-sub\0" + email` with SHA-256, takes the integer modulo `10^20`, pads it to 20 decimal digits, and prefixes `1`. The credential door ensures that first member's Google account in addition to the explicit nested consenting person. A sub already owned by another email is refused.
