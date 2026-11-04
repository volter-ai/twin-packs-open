# @volter/twin-fal

Protocol 3 fal pack for Volter Editor's API-key check and Ideogram image generation.
Editor calls `GET https://api.fal.ai/v1/models/pricing?endpoint_id=fal-ai/flux/dev`;
The customer life calls `POST https://fal.run/fal-ai/ideogram/v2` and downloads the returned image URL.
Both use the same `Authorization: Key …` credential.

`POST /_twin/app-credentials` stands in for creating a key on the dashboard and fills `FAL_KEY`.
`GET /_twin/media/{name}` serves retained placeholder bytes from the World's resource blobs.
The twin runs no image model: output is a labeled deterministic PNG, or a data URI with `sync_mode`.
Its dimensions are a stub choice, not a guarantee of production pixel dimensions. The extra
resolution, num_images and output_format fields do not change Ideogram's PNG output.

Pricing defaults to the vendor's published flux/dev example (0.025 USD per image), and a World's
scenario can script other stateless pricing results or faults. This fixture is not live account pricing.
Queue requests, other models, other Platform endpoints, dashboard management and real model quality
are outside the served scope and answer the vendor-shaped gap. Model calls and pricing have no
stored vendor resource to refresh; shared keys and placeholder media are private World bookkeeping.

Demand, decision table, the customer life and published examples are in `journeys/`; vendor specs
and correction evidence are in `spec/` and `platform/spec/`.
