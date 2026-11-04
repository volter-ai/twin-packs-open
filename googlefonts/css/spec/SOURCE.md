# Google Fonts CSS API v1 and CSS2

This contract is written from Google's https://developers.google.com/fonts/docs/getting_started,
https://developers.google.com/fonts/docs/css2 and the retained responses in vendor/inputs.json,
vendor/inter.json and vendor/noto-sans-sc-text.json. google-webfonts-helper calls
GET /css?family=<family>:<variant>&subset=<subsets> with the exact configured
User-Agent and consumes each @font-face's font-family, style, weight and src URL.
Dub's Open Graph routes call GET /css2?family=Inter:wght@<weight> and Rallly's
calls GET /css2?family=Noto+Sans+SC:wght@<weight>&text=<text>, both from a server
without a browser User-Agent, and read the truetype src URL.
The supplied representations retain actual vendor CSS. Requests without a
published representation answer a refusal, never an invented font format.
text/display/effect on /css are outside this client's demand.

SHA-256 `openapi.json`: bf7b9a3b70c3a75712fb784e22bfe07c0008dd55e1aa93b31cba8da26a64fb60
