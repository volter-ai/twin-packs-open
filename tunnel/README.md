# @volter/twin-tunnel

The tunnel relay twin (Protocol 3): Volter's volter-tunnel relay as Volter Harness's remote access uses it
([journeys/demand.json](./journeys/demand.json)). A client opens the control socket (`/ws?id=<tunnelId>`) and
registers with its account's token; it is told its tunnel's URL (`https://<tunnelId>.voltertest.xyz`). A request to
that host (or `?__tunnel=<id>` on the relay's direct host) is sent down the socket as a `request` frame and answered with
what the client sends back: a whole `response`, or `response-start`, `response-chunk`s and `response-end` (the kernel's
request answered by a session). No client holding the tunnel is 502 "Tunnel not connected"; no answer in 30 s is 504; a
body over 750000 bytes is 413. A second registration of a live id needs `replace` (the first is closed 4001); another
account's id and a bad token are refused (4002 for ownership/collision, 4003 for an invalid token). Visitor authentication gates, browser WebSocket bridging, quotas, the inspector and reservation expiry are not served. The demand is the API relay, so no workspace screens are needed.

The executable life checks public HTTP requests while its client answers on the control socket, including buffered pages and streamed command output. Relay authentication cookies and query parameters are removed before forwarding; visitor-supplied forwarded addresses are replaced by the edge address or the relay sentinel.

The World's door: `POST /_twin/accounts` ({ slug }: an account and its token). The credential door answers TUNNEL_SECRET
and the relay URL (TUNNEL_SERVER_URL, SUPERCODE_TUNNEL_SERVER_URL).
