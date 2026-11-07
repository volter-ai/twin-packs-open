# @volter/twin-googleoauth

The googleoauth twin (Protocol 3). Its surface is derived from the vendor's spec (`spec/`, provenance in
`spec/SOURCE.md`); what it serves and why is its manifest and semantics.

Rules, layout and tools: twin-world's architecture ("Protocol 3", "The catalog: where twins come from").

The credential door ensures the organization's first member's Google account in addition to the explicit nested consenting person: their own account where they signed up, else one made under the sub their sign-up would have (`accountSub`, drawn from a secret the World holds). A sub already owned by another email is refused.
