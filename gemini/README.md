# @volter/twin-gemini

The Gemini Generative Language API v1beta twin, Protocol 3, derived from the retained Discovery
contract in spec/. It serves models.generateContent and models.streamGenerateContent for the
LibreChat calls in journeys/demand.json. Twenty's Google integration requires GOOGLE_API_KEY
and is recorded as optional. Other operations answer the gap.

The twin runs no model. A World scenario supplies model judgment; otherwise a labeled synthetic
stub supplies text, schema-shaped JSON, a declared function call or a labeled placeholder PNG at the requested size.
Streaming uses Server-Sent Events with alt=sse, otherwise a JSON array. Text and function-call token counts use a
four-character estimate; no model tokenizer measures image tokens. Model availability follows the vendor's dated release/shutdown table.

Scenarios match modelEquals, userTextIncludes, anyTextIncludes, lastMessageIsToolResult,
toolResultFor, hasTool and generationConfigEquals. They may supply text, functionCalls, thinking, finishReason, parts,
groundingMetadata, safetyRatings and promptFeedback. Google Search grounding is scripted;
the twin performs no search. Sampling parameters are inputs to scripted judgment; no stochastic model runs.

The World issues AI Studio credentials through POST /_twin/app-credentials and fills
GEMINI_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY, GOOGLE_API_KEY and GOOGLE_KEY. Calls carry the
key in x-goog-api-key or the key query parameter. POST /_twin/api-keys with {name} creates a
separate key. Keys remain in World secret custody.
