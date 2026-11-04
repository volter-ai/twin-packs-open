# elevenlabs customer life: outline

**Tidewater Yoga** makes social videos with **Scheduler**, reads answers aloud in
**LibreChat** (LibreChat-AI/LibreChat at `f10b1d9`), and gives its coding sessions a voice in meetings with **Volter
Harness** (volter-ai/supercode at `6262057`), and speaks its livestream with **Raiku** (volter-ai/agent-stream at `c34b748`) (../journeys/demand.json). The twin runs no model: speech is labeled
silence of the text's length, and an agent's turn the World's scenario's when it scripts one, else a labeled stub.

## Act 1: Monday 12 January, 09:00: Scheduler makes a video, LibreChat reads aloud

Jun, the studio administrator, and Maya, its owner, share the unrestricted synthetic account API key across the apps and live monitor. Ada receives a signed URL; the front-desk caller has public access. The World issues the key (`door:appCredentials`). Scheduler lists the premade voices, Rachel among
them (`get_user_voices_v2`). Maya uploads a spoken studio welcome as an MP3 sample through the API (`add_voice`),
then opens the console voice selector to choose her cloned studio voice. The list holds both voices, and LibreChat is
handed the World's key too: the same one. Scheduler sends a whole class description as one slide, past the model's
character limit (400), then splits it: the first schedule slide's voice-over is an MP3 at 44.1 kHz and 128 kbps
(`text_to_speech_full`), followed by the next configured slide. The
studio's livestream voice, Raiku, speaks a line as raw PCM at 24 kHz in Flash v2.5 (`text_to_speech_full`), then opens
its live voice on the stream-input socket (`socket:streamInput`): on Rachel it initializes with a single space, sends a sentence with flush and is sent its PCM audio with each
character's timing, and ends the line with an empty text: the final message, and the socket closes.
LibreChat streams its next message in the cloned voice (`text_to_speech_stream`).

## Act 2: Monday 12 January, 10:00: Volter Harness gives Ada's coding session its voice

Jun creates the custom voice server's workspace secret through `create_secret_route`, captures its id, and configures its synthetic submitted value as the server's required Bearer credential. `setup-elevenlabs` provisions Ada's voice agent (`create_agent_route`): a custom LLM, her client tools (delegate,
hand_off), English on eleven_flash_v2 speaking PCM at 24 kHz, the client events Harness reads, signed-URL
authorization, and the prompt, first message and voice overrides allowed. Ada's signed URL is issued (`get_conversation_signed_link`).
On the signed URL (`socket:conversation`) she starts the conversation with her prompt and voice and is
sent its metadata (its id, PCM at 24 kHz). Her agent's LLM is her own voice server (a custom LLM, chat completions), which
ElevenLabs asks each turn of; the World's application answers for it (the life's `application`). Maya's question about
the booking page draws the server's answer as audio, the answer and agent_response_complete; asked to check a failing
test and a flaky deploy, the server calls her delegate tool twice (client_tool_call), she waits after her session
accepts the first (client_tool_result) and, once it accepts the second, says both are with her session and is done; user
activity draws nothing. Jun opens the live monitor to verify that both delegations reached the coding session; the conversation reads back in progress (`get_conversation_history_route`), its transcript
holding the tool calls and their results.
Three minutes later she leaves, and it reads back done: 180 seconds, with billing unavailable (`cost_fiat: null`) because no plan or exhausted balance is established. Her voice
reconnects for a new conversation: Maya asks about the release, and her voice server, streaming the tool call, hands the floor to Bea (`hand_off`); when the meeting grants it, the server fails the next turn three times
(503, an empty answer, then unreachable), the conversation is closed as failed (1011), and Harness's receipt reads it
failed with the LLM's error. A new refresh consumer reads the
account back: its agents (`get_agents_route`: Ada's, with its voice) then each full agent configuration and workspace secret metadata (including Ada's dependency, without its value), and her conversations newest first
(`get_conversation_histories_route`: the failed one, then the done one), one at a time by the cursor.

## Act 3: Monday 12 January, 11:00: the studio's front desk answers callers on its website

The studio makes a front-desk agent on ElevenLabs' own LLM, in Maya's voice, with a `book_class` client tool and a
public widget (no signature). Its turns are the World's scenario's (journeys/scenario.json). Kai, who keeps the studio's
website, puts a spring-term greeting in the widget's embed (override-first-message) without allowing that override in the
agent's settings, so the first caller's conversation is closed (1008); Kai takes it out. The next caller opens the widget and
hears the desk's first message; asks when the next Yin class is and is answered; asks to be booked into Thursday's Yin
and Saturday's flow, and the desk calls `book_class` twice, waits for the first booking, and confirms both once the
second is made. During the World's scripted LLM outage a question's turn fails, and the widget, which takes client_error,
is told (503).
The caller leaves after the outage notice.
