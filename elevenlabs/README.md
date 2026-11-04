# @volter/twin-elevenlabs

The ElevenLabs twin (Protocol 3), derived from ElevenLabs' own OpenAPI document (`spec/`), serving what the applications
call ([journeys/demand.json](./journeys/demand.json)) at `https://api.elevenlabs.io`: text to speech, whole and
streamed, in MP3 or PCM, and from streamed text over the WebSocket at `/v1/text-to-speech/{voice_id}/stream-input`, the account's voices (v2) and cloning one, and ElevenAgents: an agent made, its signed URL, the conversation
over the WebSocket at `/v1/convai/conversation`, and the conversation read back; the agents and conversations listed, agent configuration read in full, and workspace secrets created and read as metadata. Every other operation is `unmodeled`.

**The twin runs no model.** Speech is real, playable silence in the format asked for: MP3 frames after an ID3 title that
says what they are, or raw 16-bit mono PCM (`pcm_<rate>`, `audio/pcm`; Raiku's voice server asks `pcm_24000`); the applications ask
for MP3 and PCM alone, and another codec is refused as the twin's gap. It is as long as the text would take to say at about 15 characters a
second, so a client that reads the audio's duration reads a plausible one. On the stream-input socket (Raiku's live
voice) the client's text is buffered and spoken on `flush`, in `auto_mode`, at the chunk schedule's length or when an empty
text ends it (the first message's too): each chunk of audio (PCM in one-second chunks) comes, when `sync_alignment` is asked, with
`alignment` and `normalizedAlignment`, the chunk's characters with even timings over its length, and the end is
`{isFinal: true}` and a normal close. An unknown voice or model, v4 Turbo (which ElevenLabs speaks on text to dialogue's
socket instead, as Raiku's own code records), an unwritten codec, or a key the World did not issue (in the upgrade's `xi-api-key` or the first message) closes it
(1008). The voice is the socket path's parameter (`{voice_id}`). Text to dialogue's stream-input socket (v4)
is not modeled. An agent whose LLM is a
chat-completions custom LLM (Volter Harness's) takes each turn from that endpoint, asked as ElevenLabs asks it (the
prompt, the transcript and the agent's client tools, streamed), and three failed attempts end the conversation failed.
Other custom LLM protocols close as an explicit gap. A stored workspace-secret reference supplies the chat-completions Bearer credential. An agent using ElevenLabs' own LLM's turn is the World's scenario's when it scripts one (the OpenAI wire's `on`/`respond` keys: text,
toolCalls), else a labeled stub. A turn is spoken as silence in the agent's PCM or μ-law output format; a tool call goes
out as `client_tool_call` and is answered by `client_tool_result`, and a scripted fault is sent as `client_error`.

The default voices are the one ElevenLabs' spec names, Rachel (`21m00Tcm4TlvDq8ikWAM`); a World adds the voices it needs
through the API, `POST /v1/voices/add` (Instant Voice Cloning; the twin trains nothing). A text past its model's
character limit is refused.

A conversation is stored in progress when it starts, its transcript growing each turn, and is done when the client hangs
up, with its duration and unknown billing (`cost_fiat: null`); the synthetic account has no plan or usage balance. A vendor-backed World takes ElevenLabs' post-call webhooks
(`ElevenLabs-Signature`, `v0`).

`xi-api-key: sk_…`, kept by its SHA-256. The World's application is issued its key when the World boots:
`POST /_twin/app-credentials` answers HTTP 201 with `{ api_key: 'sk_…' }`. The descriptor's credential door maps
that `api_key` to `ELEVENLABS_API_KEY` when the World injects the app's environment.
