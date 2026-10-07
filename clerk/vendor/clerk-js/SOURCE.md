# @clerk/clerk-js, as published

The browser bundle Clerk publishes, served byte for byte at the loader path `/npm/@clerk/clerk-js/…` (the path
clerk-js's own loader in `@clerk/clerk-react` and `@clerk/nextjs` requests from the instance's Frontend API host), so an
application's unmodified Clerk components run against the twin.

- **Package:** `@clerk/clerk-js` **5.127.2**, from the npm registry:
  https://registry.npmjs.org/@clerk/clerk-js/-/clerk-js-5.127.2.tgz (source repository
  https://github.com/clerk/javascript, `packages/clerk-js`).
- **SHA-256 of the published tarball:** `1ba0ec232f0f1eecdf351f2ca82a6ede1fae20455b680a460536b6290c72eddd`
  (the registry's integrity: `sha512-3utdpDMDJVGC3DH1K6qC0JwyxOFhud6l5NZ2iDJeg4Je/ybFV6964GDxP56mqVwgKkdh1g/2wakQHfqlXN08Ww==`).
- **What is kept:** `dist/`, the tarball's `package/dist/` without its ES modules (`clerk.mjs`, `clerk.no-rhc.mjs`) and
  its `types/`, which no browser loads: 136 files, each byte-identical to the tarball's (checked 2026-09-28 with
  `diff -rq` against the extracted tarball). The main bundle, `dist/clerk.browser.js`, has SHA-256
  `68d19a34af8bdb85e82f5f1a19e88aab49af1080df416365039f914b29f3abe3`.
- **Licence:** MIT (`LICENSE`, the tarball's own, Copyright (c) 2022 Clerk, Inc.).
- **Corrections:** none. The twin serves the files as published; it rewrites nothing in them.
- **History:** vendored 2026-08-26 as `client/clerk-js-dist/` (commit 504e29efe), moved here unchanged on 2026-09-28.
