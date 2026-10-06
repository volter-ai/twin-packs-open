# openai customer life: outline

Author: Contributor 84.

## The customer

**Lindenhof** is a sixteen-person architecture practice in Utrecht. Its OpenAI organization and LibreChat Assistants integration were established in July 2025, before the August 26 deprecation, and the life begins there. January maintains that integration and rotates keys for its self-hosted tools, every one of them
calling OpenAI with a project key of the practice's one organization (../journeys/demand.json):

- **LibreChat** (LibreChat-AI/LibreChat at `f10b1d91f1ee`), the staff's chat, whose Assistants endpoint runs the
  practice's "Planning rules" assistant over zoning documents whose actual source extract is supplied in its instructions (Assistants v2: assistants, threads, messages,
  runs and their tool outputs, Files), titles conversations with Chat Completions, draws and edits concept images with
  the image tool, moderates messages, transcribes dictation, reads answers aloud and lists the models a user may pick;
- **Twenty** (twentyhq/twenty at `1d561b8c73c9`), its CRM, whose AI chat answers with the Responses API (streamed, with
  tools);
- **Rallly** (lukevella/rallly at `3e63239dbdec`), whose poll moderation asks `gpt-4.1` through the Responses API;
- **Postiz** (gitroomhq/postiz-app at `e0a08a7d9592`), its social scheduler, which picks clips with a structured Chat
  Completion, draws a post's picture, streams its copilot chat and runs its scheduling agent on the Responses API;
- **Workbench** (volter-ai/workbench at `c24c5253922f`), the box a coding agent (Pi) works in, which takes its turns
  from Chat Completions, streamed with its shell tool;
- the **on-call agent** of Twin's cookbook (volter-ai/twin-world at `96ca4478bb39`), which triages an issue with a
  Chat Completion on the runtime's own key;
- **Volter Harness** (volter-ai/supercode at `62620578c014`), whose voice front gives Marit's coding agent a voice in
  a meeting over the Realtime WebSocket;
- the **practice's own scripts**, written by Daan de Vries, a junior architect who codes, on the openai SDK for Python:
  the 2024 sketch-cleanup script, which still edits sketches with DALL-E 2; from March the **permit desk**, which drafts
  the practice's permit paperwork (summaries, mail triage, application fields, cover letters, plan comparisons, spoken
  summaries); and in July the open studio's **question tablet**, a Realtime client that answers in text, asked by typing or
  by holding its speak button.

The twin runs no model: a turn is the World's scenario's, else a labeled stub; the Realtime socket's audio is silence
with the turn as its transcript. The life runs with no scenario. The life starts on 14 July 2025 (its `startsAt`), while the Assistants API still made assistants, and its waits carry the clock to January 2026; the arc runs through November 2026. The maintained Assistants acts all precede its August 26 shutdown. Harness uses gpt-realtime-2.1 only after its July 6 release. The sketch script's last DALL-E 2 edit precedes that model's May 12 shutdown.

## People and programs

| who | holds | how |
|---|---|---|
| Marit Jansen, IT lead, the organization's owner | her dashboard owner login, permitted to issue and revoke project keys | the API keys page of the Default project |
| LibreChat, Twenty, Rallly, Postiz, Workbench, the voice front | one all-permissions project API key each | the openai SDK, the AI SDK's OpenAI provider, LangChain's and CopilotKit's clients, Pi, a WebSocket |
| the on-call agent | the runtime's all-permissions project API key | the openai SDK |
| Daan de Vries, junior architect, for the practice's own scripts | the Studio scripts project key, all permissions | the openai SDK for Python, a WebSocket |

## The arc

### 0. The planning integration (Mon 14 Jul 2025)
The World holds Marit's owner account and the organization's Default project, with the key it issues its applications.
LibreChat's Assistants endpoint is installed on that key: it uploads the zoning extract with purpose `assistants` and
makes the Planning rules assistant through the Assistants API, as OpenAI made it then: its instructions carry the
extract, with its parcel lookup function, and the extract is among its code interpreter's files. Nothing more happens
until January.

### 1. Replacement keys (Mon 12 Jan)
Marit's account is the existing organization's owner. Her password manager supplies her previous password;
she corrects it and makes replacement keys for each application's ordinary project API grant, with all permissions,
and one for the practice's own scripts. Rallly's administrator mistypes the copied key in its configuration: Rallly's
next poll moderation, its own Responses call, is refused as an incorrect API key.

### 2. Maintaining the planning integration (from Tue 13 Jan)
LibreChat maintains the Assistants endpoint installed in July 2025 and the Planning rules assistant it made then (act
0). The 2026 sittings only use and maintain it. Joost's new selector
worker lists the assistants; a separate conversation worker receives only the selected assistant id and loads its
configuration.

Joost's rooftop question, with the cadastre's aerial photo of the parcel attached by its link, starts a thread, message
and run. The run requests the parcel lookup and LibreChat supplies the cadastre's result. Meanwhile Marit, reviewing the
integration this morning, opens the Planning rules assistant in LibreChat's builder. Joost, tired of watching the spinner, presses stop just
as OpenAI finishes the run: the cancellation is refused, because the run has already completed, and he reads the
labelled stub answer after all. Its UI loads messages and run steps; a transcript-export
worker loads the reply by id, and LibreChat tags that reply with its conversation metadata. Joost asks about the setback,
then a client call makes him leave: cancellation catches the asynchronously started run in progress. Joost's answer did
not say which rule it applied, so Marit adds to the assistant's instructions that each answer names the zoning rule it
applied, keeping the extract. The conversation is deleted on January 30.

### 3. LibreChat's chat (Mon 2 Feb)
LibreChat requests a conversation title and streams an answer, treating both as labelled stubs. Its image tool requests
a DALL-E concept image and downloads the labelled PNG placeholder from the URL returned. Independently, Joost supplies
a drawn canal-house sketch and asks the image edit API to add a green roof; the output remains a labelled placeholder.
A standalone moderation classifies his zoning question before the UI permits it in chat. Joost supplies a source zoning
excerpt for text to speech, which the twin renders as silence. Imported audio preferences omitted the voice selection,
so a separate speech request is refused.

### 4. The CRM (Tue 3 Feb)
Twenty's AI chat answers a question about a client with the Responses API, streamed, and calls a CRM search tool the
first time; then the tool's output is answered with text. Joost dictates a question to LibreChat (speech to text).

### 5. Postiz and the on-call agent (Wed 4 Feb)
Postiz picks clips from a video's transcript with a Chat Completion whose response format is a JSON schema, draws the
post's picture and streams a copilot answer. Twin's on-call agent triages an issue.

### 6. The permit desk's first day (Mon 9 Mar)
Daan starts the permit desk with the Studio scripts key. Its first run replays the conversation history of his Gemini
prototype, whose replies carry Gemini's role `model`: OpenAI refuses the messages. With the roles mapped to OpenAI's,
the desk summarizes the Oudegracht 112 permit decision: two candidate summaries for Joost to choose from, stopped
before the letter's objection-procedure boilerplate, and stored with the project's metadata for the practice's records.
Its mail triage then asks whether an incoming letter is a permit decision, one token, biased to Y or N. Joost chooses
the second candidate and, cycling to the site, has the desk give it to him as a spoken summary (gpt-audio-mini, text
in, audio out).

### 7. The application's fields (Wed 18 Mar)
Daan's tagging step asks for JSON in JSON mode and is answered a JSON object of tags. The application form's fields come from his Pydantic model, which inherits a base
model and so emits `allOf`; Structured Outputs refuses that composition. Flattened, with the parcel in the cadastre's
format (or null when a form names none) and the setback as a shared definition that is a number or null, the schema is
answered with conforming fields.

### 8. The cadastre is down (Thu 19 Mar)
Joost asks the Planning rules assistant about parcel UTR-B-0457 in a new conversation. The run requests the parcel
lookup, but the national cadastre is down for maintenance and LibreChat's lookup only answers twelve minutes later,
after the run's ten-minute expiry: OpenAI refuses the late tool output, the run having expired.

### 9. Letters and the records (Mon 13 Apr)
The neighbouring Oudegracht 114 application needs the same cover letter with only the address and parcel changed: the
desk sends the existing letter as its predicted output. It registers the application by forcing its register function.
The client asked for the news by WhatsApp: the desk sends a spoken note in Opus, the format for
communication over the internet.

### 10. Comparing the plans (Tue 21 Apr and Wed 22 Apr)
The desk moves its comparisons to the Responses API. Its first request passes one message object where Responses takes
a string or a list of items: refused. Listed, it starts a background comparison of the 2019 and 2026 zoning plans for
Oudegracht 112, then a second one that Daan sees carries the wrong district's plan, and cancels it. Ten minutes later
he stops the desk; its exit handler cancels each background job it has not collected: the cancelled one answers as it
is, the first is refused because OpenAI has finished it. The next morning the restarted desk collects the finished
comparison.

### 11. A scanned decision and the digest (Mon 4 May)
The desk uploads the scanned Kerkstraat 9 permit decision to expire after a day, as the practice's privacy rule keeps
a client's documents no longer than their use. It sends the scan itself and is answered. The weekly permit digest goes out as audio for staff phones, in
AAC. The scan expires the next day.

### 12. DALL-E 2's last run (Thu 7 May)
Before DALL-E 2 shuts down on May 12, the 2024 sketch script runs one last time, as it always has: Daan has erased the
square canal-house sketch's roof to transparency, and dall-e-2 fills that transparent area with a green roof.

### 13. A coding agent's voice in the design review (Tue 7 Jul)
After gpt-realtime-2.1's July 6 release, Harness uses it for the design review. A newly launched voice front omitted its
environment key, so its preview connection fails; loading the project key lets it connect. It sets its instructions,
delegate, sleep and hand_off tools, no turn detection, and marin voice. Joost asks about facade drawings; a model turn
requests delegate. The front supplies the coding session's acceptance and requests a brief spoken response. Joost
interrupts playback after the vendor has already completed generation: the cancellation finds no active response and
the conversation item is truncated at the playback stop. The coding session then reports revision B is current and
matches the survey; the front supplies that actual text in an out-of-band response's instructions. Marit wants a clearer
voice in the room and mistakenly tries to change the spoken session to cedar; the vendor refuses. The front hangs up.

### 14. Moderation, agents and models (Sat 18 Jul)
Rallly checks a poll title through Responses. Postiz's scheduling agent, streamed, requests its schedulePost tool for
the Oudegracht 112 open studio on Friday; Postiz schedules the post and returns the tool's output, and the agent's turn
completes. LibreChat loads the model picker.

### 15. The open studio (Fri 24 Jul)
Postiz's agent announced the Oudegracht 112 open studio for Friday. A visitor types a question on the
tablet; the tablet, a Realtime client answering in text, asks for a text response and shows it as it streams. Daan's new
speak button turns turn detection off, so releasing the button ends a question. A visitor holds it and starts asking;
the tablet streams her recording, which OpenAI takes without reply. She stumbles and slides to cancel: the recording is
cleared, and the release that follows still commits, refused with nothing recorded. She asks again and releases: the
recording is committed as her message, and the tablet shows the text response. She taps replay, and the tablet retrieves
her recorded message; she would rather her voice not be kept, and the forget button deletes it, so replay tapped again
finds nothing. The stop button Daan copied from OpenAI's WebRTC sample sends output_audio_buffer.clear, which a WebSocket
connection is refused. At closing time the tablet hangs up.

### 16. Workbench's model update (Mon 17 Aug)
Pi adopts gpt-5.4-mini after its March 17 release and observes a streamed shell-tool request. The life does not claim
that this requested shell command was executed.

### 17. A leaked key (Tue 15 Sep)
Rallly's key is pasted in a public issue. Marit revokes it; Rallly's next moderation call, made before its
configuration takes a new key, is refused, and with the new key it is answered.

### 18. Codex account at the planning desk (Thu 24 Sep, after the pinned runtime release)
Marit uses her World-issued OpenAI subscription account in Volter Harness. Its browser login opens authorization with localhost callback, state and S256 PKCE. Wrong credentials leave the consent page; the correct credentials issue a code, exchanged once; repeated-code and rotated-token rules are replayed as published client rules. OA and RH2 obtain the access token/account claim from Codex app-server and forward a streamed Responses turn. Hermes discovers the per-account models. Native Codex sends the next permit checklist turn as level-3 Zstd JSON when request compression is enabled. Substrate’s native Codex opens Responses WebSocket, prewarms without generation, calls a function and sends its output in the incremental follow-up. Substrate’s signed-in native TUI prefetches account limits; the desk checks workspace headlines and token activity, then compacts a long conversation. Marit signs in on Substrate with device authentication: pending polling, the printed user code entered on the World’s page, PKCE exchange and a token accepted at the backend. Codex refreshes before the one-hour expiry, then logs out; the published-rule replay checks that the revoked grant stops inference. A second device request ages beyond the published fifteen-minute window and cannot authorize. The long-lived application key in later acts stays independent of subscription grants. Unsupported cloud-task paths remain the gap.

### 19. Retiring the extract (Sun 1 Nov)
The 2025 zoning extract is superseded; staff delete its file.

## What the life does not do
Embeddings, fine-tuning, batches, vector stores, uploads, evals, containers and the Admin API: no application here
calls them. Published file-search examples also exercise an empty vector store and its readbacks.

The desk migration also corrects a fractional sampling seed to an integer, a generic json format label to json_object, and a list of bare plan strings to Responses input-item objects. The spoken permit notice supplies WAV to the presentation editor and lossless FLAC to the records archive as well as Opus to the client.

Maya drafts a CRM follow-up with Twenty’s default fast GPT-5.6 Luna at medium effort;
the model’s documented effort list refuses minimal. The model is live after its 9 July 2026 release.
