# Google Fonts font files

Google's CSS API guide https://developers.google.com/fonts/docs/getting_started
describes the stylesheet link and font selection. The retained vendor responses
for the exact application user agents (vendor/inputs.json) bind each actual src URL
to its font file; EOT and SVG use /l/font with kit/skey/v, the other representations
use /s/<family>/<version>/<file>. All bytes and Content-Type values are unchanged
vendor answers, retained under their source hashes. No format conversion occurs.
Only GET is demanded; unsupported operations remain gaps.

SHA-256 `openapi.json`: a008d26adacbeaa5027767e9fa6eadce49ef5b8bdefcb6aa8f3ed9ee07347ac5
