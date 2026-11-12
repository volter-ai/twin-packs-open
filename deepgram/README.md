# @volter/twin-deepgram

Protocol 3 twin of Deepgram's REST API. Nothing is served: every spec operation
answers the vendor-shaped gap. No transcription, scenario adapter, credential door,
stored resource or refresh is served.

No scanned application calls Deepgram (twin-world's generated/demand.json).

Authentication retains the documented Token and Bearer forms. Missing or malformed
credentials receive `401 INVALID_AUTH`. The docs give no unknown-route body, so the
gap uses their documented `404 PROJECT_NOT_FOUND` class with `err_code`, `err_msg`
and `request_id` ([errors](https://developers.deepgram.com/docs/errors)).
No vendor key is issued or stored.

`spec/SOURCE.md` records the unchanged vendored spec and its hash. Published
examples remain unchanged and count as unserved; every operation's reason is in
`journeys/decisions.json`.
