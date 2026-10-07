# Standing

Written by twin-world's `bun scripts/pack-standing.ts`, grading this repository at 2de6ae6; do not edit. A pack is **in the form** when it and each of its lanes meet the form section of the grade (`@volter/twin-standard`: the spec and its provenance, the manifest, the generated surface reproduced, the layout, the handler, engine and kernel contracts, the states), and each holds the files conformance reads (its decision table, its vendor's life). This says what a pack holds, not that it works: that is `scripts/pack-done.ts`.

12 of 12 packs are in the form.

| Pack | In the form | Our products that call it | First commit | Last commit |
|---|---|---|---|---|
| anthropic | yes | Volter Harness | 2026-10-06 | 2026-10-06 |
| clerk | yes | — | 2026-10-06 | 2026-10-06 |
| cloudflare | yes | RH2, Volter launch World | 2026-10-06 | 2026-10-06 |
| github | yes | Open Autonomy, RH2, Substrate, Twin, Volter Editor, Volter Harness, Workbench | 2026-10-06 | 2026-10-07 |
| linear | yes | Twin | 2026-10-06 | 2026-10-07 |
| openai | yes | Open Autonomy, RH2, Substrate, Twin, Volter Harness, Workbench | 2026-10-06 | 2026-10-06 |
| resend | yes | Twin | 2026-10-06 | 2026-10-06 |
| slack | yes | RH2, Twin, Volter Harness | 2026-10-06 | 2026-10-06 |
| stripe | yes | Open Autonomy, Twin | 2026-10-06 | 2026-10-06 |
| supabase | yes | — | 2026-10-06 | 2026-10-06 |
| tavily | yes | — | 2026-10-05 | 2026-10-05 |
| upstash | yes | — | 2026-10-06 | 2026-10-06 |

## What is outside the form

Nothing.

## What the vendor-backed half lacks

A pack is vendor-backed when its manifest says how each stored resource is read back from the vendor (`refresh`) and how the vendor's events reach it (`ingest`), or says why it cannot be (`vendorBacked.none`): twin-world's architecture, "The real-system adapters". This does not move a pack in or out of the form.

Nothing.
