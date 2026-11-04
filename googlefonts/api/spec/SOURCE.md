# Google Fonts Developer API

The unchanged Discovery document is Google's webfonts v1 contract, fetched
2026-10-12 from https://www.googleapis.com/discovery/v1/apis/webfonts/v1/rest.
It is converted by twin-world/scripts/spec-discovery-to-openapi.ts with that
explicit date, retaining its revision, method id, schemas and parameter metadata.
The vendor's documentation is https://developers.google.com/fonts/docs/developer_api.
The application uses the documented older www.googleapis.com/webfonts prefix;
the manifest's pathPrefix strips that prefix before the same derived operation.
The Discovery base webfonts.googleapis.com/v1/webfonts is also served. Sort values
are case-normalized, because the documentation and actual pinned app use lowercase
popularity while Discovery lists uppercase enums. Advanced capabilities are outside
this static-TTF catalog's demanded path and return a named refusal.

SHA-256 `openapi.json`: 81395430e46dbeba78ab69301daa459d4e8fcfe80dfdf493118ce1c6e5a255b1

SHA-256 `discovery.json`: `9dfed5186ad6ee434a82a33737af9ddc3a157005d7d6922820ac5d42ccef41f1`.
