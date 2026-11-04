# Harbourline's Gemini customer life

Author: Contributor 95. World starts 2026-09-28, before the image tool's default model shuts down.

Harbourline uses LibreChat's shipped Google endpoint and image tool. Priya prepares an autumn
workshop. LibreChat ships GOOGLE_KEY=user_provided and includes google in defaultEndpoints;
the configuration evidence and pinned call sites are in demand.json. Scripts supply model
judgment; unscripted turns are labeled synthetic outputs.

On Monday 28 September, the World bootstraps its Gemini application credential. Priya creates
her own separate LibreChat key in AI Studio; LibreChat's shipped Google endpoint accepts it.

On Tuesday, Priya plans the workshop in LibreChat. The chat streams thinking and text. That
afternoon she enables the shipped Google Search tool for an announced date lookup, then asks
LibreChat's image tool for a square illustration. Its default gemini-2.5-flash-image returns
synthetic PNG bytes.

On Wednesday, Priya edits that same picture: LibreChat sends its captured bytes as inline context.

On Friday 2 October, Priya's saved image tool still selects its default model, which the vendor's
deprecations table shuts down that day. The tool's real error path reports that generation failed.

Operations: models.generateContent (image generation/editing) and models.streamGenerateContent
(LibreChat's SSE conversations and Google Search). appCredentials and apiKeys stand in for
credential setup. Google Search is matched only when the request offers googleSearch; the square
image asserts PNG dimensions. Evidence and exact commits are in demand.json.

Files, cached contents, embeddings, tuned/dynamic methods, model/token listing and live sockets
have no demanded call. Published examples walk vendor rules separately; no life step is added
to cover an implementation line.
