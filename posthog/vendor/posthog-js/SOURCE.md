# posthog-js, as published

The posthog-js bundles PostHog serves from its static files at `/static/<file>` (the files PostHog's
`frontend/bin/copy-posthog-js` copies from posthog-js's dist), served byte for byte by the ingest lane's `staticAsset`
(`../../ingest/src/semantics/static.ts`), so posthog-js in an application's page loads its lazy extensions from the twin.

- **Package, version, tarball and its SHA-256:** stated once, in `../../journeys/decisions.json`, the `staticAsset` row
  (PostHog's own catalog pin of posthog-js).
- **What is kept:** `dist/`, the 38 files of the tarball's `package/dist/` that `copy-posthog-js` names (`array.js`,
  `array.full.js`, `array.full.es5.js`, `surveys.js`, `logs.js`, `exception-autocapture.js`, `web-vitals.js`,
  `web-vitals-with-attribution.js`, `tracing-headers.js`, `dead-clicks-autocapture.js`, `customizations.full.js`,
  `*integration.js`, `*recorder*.js`, `product-tours.js`, `conversations.js`, each with its `.map`), each byte-identical
  to the tarball's. `dist/` is committed past the repository's `dist` ignore (`git add -f`), as clerk's vendored copy is.
- **Licence:** `LICENSE`, the tarball's own: `(Apache-2.0 AND MIT)`, Apache-2.0 for posthog-js (Copyright 2020 Posthog /
  Hiberly, Inc.; Copyright 2015 Mixpanel, Inc.) and MIT for the `@posthog/core` it bundles.
- **Corrections:** none. The twin serves the files as published; it rewrites nothing in them.
