# Antic reference data

The selected catalog item is the unchanged Antic object in Google's published
Developer API example (family Antic, v19, 2022-09-22), not a claim to reproduce
Google's entire catalog or current popularity. Its enclosing list is a selected
reference-data World catalog. The five CSS representations and seven font files
were retained from Google's public font servers on 2026-10-12, using exactly the
five user agents google-webfonts-helper config.ts selects at ff245dc8. The current
CSS points at v20 while the older published catalog example points at v19; both
source identities are preserved. The SVG URL's fragment is client-side and is
excluded from the stored HTTP asset key. No font was converted or substituted.

Google Fonts has no create-font operation in its Developer API. The default data
therefore calls the declared publisher door, which stores vendor-shaped items,
the actual CSS and font bytes in the World's resource/blob store. It does not
pretend that a vendor API mutation occurred. Operators may publish other actual
catalog snapshots through the same door. The seven base64 strings are transport
inputs to that door; persisted font bytes live only in the resource blob store.

The Inter data (vendor/inter.json) is Google's CSS2 answer for Inter at weights
500, 600 and 700, retained on 2026-10-15 with no User-Agent, "node" and "undici"
(the same bytes for all three), and the three truetype files it names. Inter's
font software is under the SIL Open Font License 1.1 (Inter-OFL.txt).

The Noto Sans SC data (vendor/noto-sans-sc-text.json) is Google's CSS2 answer for Rallly's
request, Noto Sans SC 700 with text= its title's two glyphs, retained on 2026-10-15 with no
User-Agent, "node" and "undici" (the same bytes for all three), and the truetype subset it names.
Noto Sans SC's font software is under the SIL Open Font License 1.1.

Antic's font software is under the SIL Open Font License 1.1 (OFL.txt).
Google documentation and its example data are CC BY 4.0, with attribution here:
https://developers.google.com/fonts/docs/developer_api
https://developers.google.com/fonts/docs/getting_started
