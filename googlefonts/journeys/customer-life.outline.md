# Google Fonts used by google-webfonts-helper, Dub and Rallly

1. Google publishes the attributed Antic reference snapshot via the publisher
   door (no Developer API font-creation endpoint exists). Actual item fields,
   browser CSS and font bytes enter the shared World store.
2. The World asks appCredentials for its issued key.
3. The unchanged helper fetches the popularity-sorted catalog with that query
   key; it consumes family/variants/subsets/category/version/lastModified and
   chooses the returned Antic regular/latin record.
4. Each of its five exact UAs asks for Antic:regular/latin. The twin returns the
   corresponding real CSS, preserving @font-face style/weight and gstatic URL.
5. Download every returned URL. The genuine EOT/WOFF/WOFF2/SVG/TTF bytes can feed
   its ordinary JSZip archive.
6. Dub's Open Graph route asks CSS2 for Inter at one weight from its server; the
   twin answers Google's retained truetype CSS and the returned gstatic URL
   downloads the genuine Inter bytes.
7. Rallly's Open Graph image asks CSS2 for the glyphs of its CJK title (text=) from
   its server; the twin answers Google's retained CSS for that request and the
   returned URL downloads the genuine truetype subset.

The customer entry uses its pinned axios 1.20.0 and the ordinary env name.
Its prerequisite publisher operation uses the included actual source snapshot.
No journey, customer entry or application execution has been performed while
building; executable recipe data is retained for the final qualification phase.
