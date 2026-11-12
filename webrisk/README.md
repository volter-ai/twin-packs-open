# @volter/twin-webrisk

Google Web Risk v1's vendored gRPC surface, with operations outside the measured demand answering
`UNIMPLEMENTED` (gRPC status 12; HTTP JSON status 501). There are no served business operations,
stored resources, credentials, events, or setup doors. The kernel supplies discovery at `GET /twin`.

[The demand evidence](./journeys/demand.json) records that LibreChat's `GOOGLE_CLOUD_PROJECT`
configures Vertex AI and names no Web Risk call. Runhuman 1 is outside the scanned applications.
Generic Google project and credential environment names therefore do not select this twin;
`@google-cloud/web-risk` and `webrisk.googleapis.com` still identify the vendor.

The proto files and their individual hashes are in [spec/SOURCE.md](./spec/SOURCE.md).
Published lookup examples are inventoried separately from the empty customer life. No vendor-backed
root is supported because no operation sends or stores vendor state. SDK cases are not owed by the
measured demand (architecture, Conformance).
