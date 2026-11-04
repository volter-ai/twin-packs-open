// Text to speech: the audio for a text in a voice, whole or streamed. THE TWIN RUNS NO MODEL: the audio is labeled silence
// in the format asked for (MP3 or PCM), as long as the text would take to say (../engine/audio.ts).
// Where the documentation stops: a model is ElevenLabs' catalogue; the twin takes an `eleven_` model id.
import type { HandlerContext } from '@volter/world-core';
import { silence } from '../engine/audio.ts';
import { bodyOf, elError, invalid, voicesOf } from './shared.ts';

const LIMITS: Record<string, number> = {
  eleven_v4: 10000, eleven_v3: 5000, eleven_flash_v2_5: 40000, eleven_flash_v2: 30000, eleven_multilingual_v2: 10000, eleven_multilingual_v1: 10000,
};

async function speak(ctx: HandlerContext, stream: boolean): Promise<Response> {
  const voiceId = String(ctx.call.params.voice_id ?? '');
  const voice = voicesOf(ctx).find((v) => v.voice_id === voiceId);
  if (!voice) return elError(404, 'voice_not_found', `A voice with the voice_id ${voiceId} was not found.`);
  const b = bodyOf(ctx);
  if (typeof b.text !== 'string' || !b.text.trim()) return invalid([{ type: 'missing', loc: ['body', 'text'], msg: 'Field required' }]);
  // source: spec:/components/schemas/Body_text_to_speech_full "Identifier of the model that will be used, you can query them using GET /v1/models."
  const model = typeof b.model_id === 'string' && b.model_id ? b.model_id : 'eleven_multilingual_v2';
  if (!/^eleven_/.test(model)) return elError(400, 'model_not_found', `A model with model ID ${model} does not exist.`);
  // source: https://elevenlabs.io/docs/overview/models.md "The maximum number of characters supported in a single text-to-speech request varies by model."
  // Where the documentation stops: a model the table does not name takes 10,000.
  const limit = LIMITS[model] ?? 10000;
  if (b.text.length > limit) return elError(400, 'max_character_limit_exceeded', `Text is ${b.text.length} characters long; ${model} takes at most ${limit} characters per request.`);
  // source: spec:text_to_speech_full "Output format of the generated audio. Formatted as codec_sample_rate_bitrate."
  const format = new URL(ctx.call.request.url).searchParams.get('output_format') ?? 'mp3_44100_128';
  const audio = silence(format, b.text, `twin-stub: silence for ${b.text.length} characters in ${String(voice.name)} (${model}); no speech is synthesized`);
  // source: spec:text_to_speech_full "PCM and WAV formats with 44.1kHz sample rate requires you to be subscribed to Pro tier or above."
  // Where the documentation stops: the spec names audio/mpeg alone as the answer's type; a PCM answer is audio/pcm, the
  // type the applications accept for it. The synthetic account's tier is not established, so no rate is refused for it.
  // Where the twin stops: the applications ask for MP3 and PCM alone, and another codec is the twin's gap, refused as such
  if (!audio) return elError(400, 'unsupported_output_format', `The twin writes MP3 and PCM alone; ${format} is not modeled.`);
  const requestId = ctx.crypto.uuidFrom(`elevenlabs-tts:${ctx.occurredAt}:${voiceId}:${b.text}`).replace(/-/g, '');
  const headers = { 'content-type': audio.type, 'request-id': requestId, 'history-item-id': requestId.slice(0, 20), 'character-cost': String(b.text.length) };
  if (!stream) return new Response(audio.bytes, { headers });
  // streamed in chunks as the audio would arrive
  const bytes = audio.bytes;
  return new Response(new ReadableStream({
    start(c) { for (let i = 0; i < bytes.length; i += 4096) c.enqueue(bytes.subarray(i, i + 4096)); c.close(); },
  }), { headers });
}

// source: spec:text_to_speech_full "Converts text into speech using a voice of your choice and returns audio."
export async function text_to_speech_full(ctx: HandlerContext): Promise<Response> { return speak(ctx, false); }

// source: spec:text_to_speech_stream "Converts text into speech using a voice of your choice and returns audio as an audio stream."
export async function text_to_speech_stream(ctx: HandlerContext): Promise<Response> { return speak(ctx, true); }
