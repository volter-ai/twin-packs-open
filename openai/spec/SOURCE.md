# openai spec — provenance

- **File:** `openapi.yaml.gz`, gzip of OpenAI's published OpenAPI document.
- **Upstream:** https://github.com/openai/openai-openapi, `openapi.yaml` on `master`.
- **Spec version:** `2.3.0` (`info.version`); server base `https://api.openai.com/v1`.
- **SHA-256 of the uncompressed document:** `52c7140f59a508965565f698580331c2b0ae0f44d1938f2da57af16607db22d0`.
- **Read by:** `bun scripts/derive-pack.ts openai`, which writes `../src/generated/surface.gen.json`.

Identity examples are cited at OpenAI Cookbook commit `0eac1447d4e24d06e47c459ca5e98f248b9413cf`: the [Assistants overview](https://raw.githubusercontent.com/openai/openai-cookbook/0eac1447d4e24d06e47c459ca5e98f248b9413cf/examples/Assistants_API_overview_python.ipynb) and the [DALL-E image examples](https://raw.githubusercontent.com/openai/openai-cookbook/0eac1447d4e24d06e47c459ca5e98f248b9413cf/examples/dalle/Image_generations_edits_and_variations_with_DALL-E.ipynb). `sources.json` records these pages and the stored-message cursor reference; the OpenAPI bytes above are unchanged.

GPT-5.6 Luna is documented by https://developers.openai.com/api/docs/models/gpt-5.6-luna;
https://developers.openai.com/api/docs/changelog dates the family release to 9 July 2026.
Twenty’s default fast model is retained with that release, the documented reasoning efforts
and current token price. No OpenAPI bytes were changed.

Screen references, read 2026-10-08: [OpenAI's project-management guide](https://help.openai.com/en/articles/9186755-managing-projects-in-the-api-platform), its Frame_12.png key table and Frame_13.png creation dialog. The published images show 2024 dates; they establish that pictured settings layout, not an assertion about a signed-in account today. The authored screen uses the project's actual keys and existing create/revoke operations. No upstream page, image, font or script is shipped.
