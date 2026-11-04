# Northwind Studio on OpenRouter

Kai Brandt builds with Substrate's vibecode and Volter Harness. Mara Quist uses Volter Editor. The studio also runs
LibreChat's OpenRouter custom endpoint. These are the running callers recorded in demand.json at the scan's commits.
Kai and Mara each authorize their own account. LibreChat uses the World application's bearer key, Kai's applications use
the bearer keys issued by his OAuth approvals, and Mara's coding agents use her dashboard key. Each key permits inference
and reading its own limits; none is a management key. The catalogue needs no credential.

The World clock starts 2026-01-01 and advances to Monday 28 September 2026 before these acts; all selected models have
then been released. Scripted turns are synthetic, as a World models model judgment; unconfigured turns are labeled stubs.
The story verifies requests, wire shapes and supplied tool results, not generated prose quality.

## 1. Connect LibreChat — Monday 28 September, 09:00–10:00
The studio provisions its application key. Kai and Mara create accounts, and Mara creates the key she will give Volter
Editor. LibreChat was launched before its key was copied into the environment, so its first request lacks authentication
and is refused. The studio relaunches it with the issued key. Its model picker reads the complete catalogue with prices. Kai starts a conversation with the attribution headers, then asks a streamed follow-up.
Doors: appCredentials, users, keys. Operations: getModels, sendChatCompletionRequest.

## 2. Connect vibecode — Tuesday 29 September, 10:00
Kai sees the authorization page for vibecode's callback and S256 challenge, approves, and the application exchanges the
captured code with its verifier for his bearer key. Substrate's chat uses that key for a streamed turn.
Screen: auth. Operations: exchangeAuthCodeForAPIKey, sendChatCompletionRequest.

## 3. Work with Volter Harness — Wednesday 30 September, 09:00–10:11
Kai authorizes the CLI's loopback callback and exchanges the returned code. A key he first pastes from an old note fails;
he replaces it with the OAuth key the CLI saved and its own-limit check succeeds. The harness requests a streamed
list_files call, supplies the returned directory listing, and gets the next assistant turn.
At 10:00 he logs into a remote box headlessly: the page shows a code, which he copies and exchanges promptly.
He also starts a fresh vibecode authorization, but leaves its tab while answering a call. Eleven minutes later its
exchange is refused because the code's documented ten-minute lifetime has passed.
Screen: auth with callback and headless. Operations: exchangeAuthCodeForAPIKey, getCurrentKey, sendChatCompletionRequest.

## 4. Code in Volter Editor — Thursday 1 October, 09:00
Mara's saved key is checked. The Claude Code launch first omits ANTHROPIC_AUTH_TOKEN, drawing the Messages authentication
error. She corrects the environment and gets the streamed turn. The next task needs the scene: the model requests Read,
Claude Code supplies scene content, and the assistant completes. Mara selects Codex for the next change and its streamed
Responses turn; Codex requests shell, receives the test result in the full stateless history, and completes.
She uses OpenCode's streamed chat surface to explain the result. Resuming LibreChat provisions the same application key.
Operations: getCurrentKey, createMessages, createResponses, sendChatCompletionRequest.

## Boundaries
The APIs not called by these applications remain the literal unmodeled list. Published examples exercise malformed
input, single-use codes, plain PKCE, structured output and scripted vendor outages separately from this customer story.
