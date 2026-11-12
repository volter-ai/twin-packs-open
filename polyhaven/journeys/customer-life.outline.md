# Poly Haven: the customer life, outline

A game studio validates its editor's asset importer against a small synthetic catalog, before selecting production
models and lighting. The publisher acts through the World's catalog door: Poly Haven publishes no public write API.
The editor's server and browser read the public catalog and download hosts without credentials. The sittings span
fourteen hours; requests are infrequent and within the kernel's fallback allowance.

1. The publisher installs three import fixtures: an armchair represented by a valid textured glTF triangle, a table
   selection with an empty glTF scene, and a one-pixel HDR/EXR sky. A thumbnail accompanies the armchair. Separate
   publisher sitting exposes an accidental duplicate slug.
2. The studio browses models, later narrows its selection to furniture and seating, then mistypes an unknown category and is refused.
   On another sitting it looks at HDRIs; a mistyped type produces a refusal.
3. The category picker displays the counts of models; later it explores categories within furniture, then the counts
   of all types.
4. The importer obtains the armchair's file manifest and subsequently the sky's manifest. The studio enters a nonexistent slug in the importer
   and is refused with no manifest.
5. The importer downloads the captured glTF URL and each included URL from that manifest. An operator mistypes a file name through
   Backblaze's documented download-by-name door and is refused. The browser reads both preview URLs captured from
   publishing responses: the armchair thumbnail loads; a table without an uploaded preview shows 404.

This story reaches get_assets, get_categories_type, get_files_id, downloadFileByName, getThumbnail and the assets door.
The fixture geometry and lighting are intentionally tiny and valid; they exercise bytes and relative includes rather
than claim to reproduce Poly Haven's production art.
