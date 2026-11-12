# DuckDuckGo search evidence

Read by Codex, 2026-10-03. No usable vendor OpenAPI is published for this HTML endpoint. spec/write-spec.ts reproduces openapi.json from retained reference bytes and recorded answers; run bun duckduckgo/spec/write-spec.ts offline from the packs root. patches.json is empty: no vendor spec corrections.

Vendor reference: https://duckduckgo.com/duckduckgo-help-pages/features/non-javascript; twin-standard read-page --raw, 2026-10-03; retained non-javascript.html.gz; raw sha256 55e16b8a56721eb169d110d99821b44e35b9dc89e3834a814220dc81476f49d4, gzip sha256 d941a7088c643350c9ab3138d357fd70a28a164b5d90bce4e3cf724478761bfe. It establishes HTML/Lite non-JavaScript versions and reliance of the primary site on JavaScript, not empty-result markup or primary search responses.

The first three recordings: curl 8.7.1 --silent --show-error --max-time 30 --retry 0; User-Agent supercode/0.5.100, Accept */*, no Authorization/body, no redirect following/browser. Exactly one request per recorded URL. recordings/<name>.json retains exact request, UTC response Date, status, body and digest; .html and .headers retain raw response bytes; .transport.json retains transport metadata with client-machine fields removed.

results: GET https://html.duckduckgo.com/html/?q=example+domain; Sat, 03 Oct 2026 21:27:59 GMT; HTTP 200; raw body sha256 956236a4ce1787b867a86b0a49679624729f704ab5f3d54fd9fd3862b1b7bcda. Successful result HTML structure, anchor hrefs and snippets.

random-query: GET https://html.duckduckgo.com/html/?q=qzxvplmnrtysabcfhjkweudogixn2847163905; Sat, 03 Oct 2026 21:33:41 GMT; HTTP 200; raw body sha256 aad582365c69a970453a92a21304755e47a048b3e104f43f0880f45724861c2e. Long random token returned ten results. It does NOT establish no-results HTML.

unknown-path: GET https://html.duckduckgo.com/volter-world-unserved-path; Sat, 03 Oct 2026 21:33:51 GMT; HTTP 200; raw body sha256 b804c474c52e13f2f3409899c934f919d556d987dbe92fdafcde426547c0e98e. Unknown path returned a JavaScript search shell and noscript redirect, HTTP 200. No 404 or functioning primary browser search is established.

Recorded HTML is the HTTP search wire, not a browser capture or authored screen. Literal recorded framing surrounds independent result blobs seeded through the World door. The gap is a labeled deterministic replay of the one unknown-path answer, without inferring the body for other unknown URLs. Ranking, crawling, query operators, navigation POST and empty-result markup are not inferred. Primary browser navigation is established only by the separate browser-search recording below.

Consumer pins establish demand only, never vendor behavior: Harness 62620578c014c4c0b1d4c34e1268e4112c9dd331 (reqwest 0.12, harness 0.5.100), Workbench c24c5253922f3ebe68d066b1e4b52776be371e1d. Call and parser citations are in journeys/demand.json.

DECIDED Both shipped product features remain demand; unanswered flows stay explicitly unestablished under the recording allowance.
DECIDED The random token returned results; retain that answer and do not retry.
DECIDED Use the observed HTTP 200 unknown-path shell for the gap; invent no 404 or completed JavaScript search.
DECIDED Store result bytes as independent blobs through the World door; lexical selection is a labeled local model.
DECIDED Replay all four recordings exactly and show source-limited flows in the life and discovery.

Retained spec writer: `write-spec.ts`. Authored openapi.json sha256 0565c33d9a16f9400f68b08fcc277e8a06fb819962a028217636ad1931537119.

DECIDED Encode script-bearing wire bytes as data decoded only to response text; the pack never evaluates them. Browser execution is blocked by the twin-only response CSP, not by encoding. No gate changes.

recordings/.gitattributes disables text normalization for the retained HTTP headers so their original CRLF bytes survive checkout.


## Primary browser navigation recording

Workbench volter-ai/workbench at c24c5253922f3ebe68d066b1e4b52776be371e1d: os/apps/stockapps.tsx:471-473 stores trimmed non-URL search text; :560 calls window.open with https://duckduckgo.com/?q=<encodeURIComponent(search)>, _blank and noopener. Browser navigation is GET, with no request body or Authorization; example domain becomes example%20domain. The product pins no embedded browser User-Agent; os/skins/mac/README.md:52 permits a normal browser. The explicitly allowed desktop-browser fallback sent the User-Agent below. No browser opened.

https://duckduckgo.com/?q=example%20domain; Sat, 03 Oct 2026 22:15:36 GMT; HTTP 202; raw body sha256 c8357c16934bd94ee72b3d6765f7a6962e1dacccfb3658c73e2274bd439b0fa8.
User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36
recordings/browser-search.json retains exact method, URL, headers, absent Authorization, body, response Date, client identity/method, start timestamp and digest. browser-search.html and .headers retain raw response bytes; .transport.json retains transport metadata with client-machine fields removed. This was ONE curl request with --max-time 30 --retry 0, no redirect following and no retry. The HTTP 202 body contains DDG.deep.anomalyDetectionBlock, scripts initializing further /d.js requests, and a noscript /html/?q=example%20domain link; it contains no result__a list. Only this initial shell/challenge is established. Challenge completion, further scripts/assets/requests and JavaScript search results are unestablished. No additional live request was made. The recorded no-script link is served through searchHtml over the existing World page corpus.

Every HTML response adds the twin-only Content-Security-Policy: default-src 'none'; sandbox and Cache-Control: no-store, max-age=0, Pragma: no-cache, Expires: 0. These controls are declared in manifest.discovery.behavior and README, not asserted as vendor headers. Bodies remain unchanged for the Harness parser and exact recording replays. Browser scripts and external resource loads are blocked; static scaffolding and a script-disabled no-script notice are the limit of the observed primary surface.

DECIDED RECIPE omits the contract's recording allowance but never forbids it; reconcile step 2 with the architecture and recorded undocumented wire precedents, without changing their evidentiary limits.
DECIDED Replay the observed primary HTTP 202 shell/challenge instead of the unrelated gap; do not invent results or solve an unestablished challenge.
DECIDED Apply the explicit twin-only CSP and no-store policy to every HTML answer, retaining parsed body bytes unchanged.
