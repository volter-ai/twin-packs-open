# @volter/twin-hubspot

Protocol 3 twin of HubSpot's CRM, Meetings and OAuth v1 APIs. Every spec operation
answers the documented not-found class (`404`) in HubSpot's JSON error envelope.
No vendor resources, credential doors, screens, webhooks or refresh operations are served.

Cal.com and Dub enable these integrations only with operator-supplied credentials
absent from their shipped defaults. The pinned gates and evidence remain under
`optional` in `journeys/demand.json`. The customer life has no acts. Published
examples remain unchanged in the vendored spec and count as unserved.

The gap and error-envelope citations are in `src/manifest.ts`; the unchanged
vendor documents, their hashes and scope-union patches are recorded in `spec/SOURCE.md`.
