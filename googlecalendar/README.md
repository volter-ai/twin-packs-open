# @volter/twin-googlecalendar

Protocol 3 twin of Google Calendar API v3. Every spec operation answers Google's
documented `404` JSON error with reason `notFound` and message `Not Found`.
No vendor resources, credential doors, screens, push notifications or refresh
operations are served.

The current demand scan detects Cal.com only as opt-in. It ships Google integration
and holiday API credentials empty and requires administrator setup for global keys.
The pinned settings and evidence remain under `optional` in `journeys/demand.json`.
The customer life has no acts. All published examples in `spec/doc-examples.json`
remain unchanged and count as unserved.

`src/manifest.ts` cites the gap, error envelope and authentication facts.
`spec/SOURCE.md` records the unchanged Discovery document, its revision and hash.
