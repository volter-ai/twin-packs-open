# Poly Haven downloads spec — provenance

- **Why this document:** the two download hosts publish no document of their own. This one is written from:
  the api lane's document (every `url` of `/files/{id}` is `https://dl.polyhaven.org/file/ph-assets/<name>`, and
  `thumbnail_url` is `https://cdn.polyhaven.com/asset_img/thumbs/<id>.png?width=256&height=256&v=<img_version>`);
  Backblaze's page for the call dl.polyhaven.org answers, https://www.backblaze.com/apidocs/b2-download-file-by-name
  (fetched 2026-09-30); and the hosts' answers read 2026-09-30 (a file: `application/octet-stream` with
  `x-bz-file-name` and `x-bz-content-sha1`; a missing file: 404 `{"code":"not_found","message":"File with such name
  does not exist.","status":404}`; a thumbnail: `image/png`).
- **Hosts:** dl.polyhaven.org, cdn.polyhaven.com.
- **Corrections:** none.
- **Read by:** the twin orchestrator, 2026-09-30; /root, 2026-10-01.
- **Vendored bytes (sha256):** `openapi.json` `9d0605be1685c7863335cd5b860765d53173a884b71d55a41930abc6f85c1264`.
