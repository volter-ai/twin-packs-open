// Audio: labeled deterministic transcripts, and speech as a real audio file of silence; the twin runs no
// speech model. Transcription and translation take the audio as a multipart file (the SDK's shape),
// refuse anything that is not an audio file OpenAI transcribes, and name the file in the transcript.
import type { Handler, HandlerContext } from '@volter/world-core';
import { base64, estimateTokens, handleSpeech, handleTranscription, type OpenAIResponseEnvelope, recordUsage, send, timeline } from './shared.ts';

/** A transcription or translation is billed by the seconds of audio heard (the usage report's `seconds`). */
async function recordSeconds(ctx: Parameters<Handler>[0], r: ReturnType<typeof handleTranscription>): Promise<void> {
  if (r.status === 200 && 'seconds' in r && typeof r.seconds === 'number') await recordUsage(ctx, 'audio_transcriptions', String(ctx.params.model), 0, 0, { seconds: Math.ceil(r.seconds) });
}

export async function createTranscription(ctx: HandlerContext): Promise<Response> {
  const gone = timeline(ctx);
  if (gone) return gone;
  const r = handleTranscription(ctx.params, false);
  await recordSeconds(ctx, r);
  return 'events' in r && r.events ? ctx.sse(r.events) : send(ctx, r as OpenAIResponseEnvelope);
}

// The audio file itself, in the format asked (mp3 unless named), with that format's Content-Type; a speech is billed by
// the characters it reads (the usage report's `characters`)
// source: spec:createSpeech "Returns the audio file content, or a stream of audio events."
export async function createSpeech(ctx: HandlerContext): Promise<Response> {
  const gone = timeline(ctx);
  if (gone) return gone;
  const r = handleSpeech(ctx.params);
  if (!('audio' in r)) return send(ctx, r);
  await recordUsage(ctx, 'audio_speeches', String(ctx.params.model), 0, 0, { characters: String(ctx.params.input).length });
  // source: spec:/components/schemas/CreateSpeechRequest/properties/stream_format "Supported formats are `sse` and `audio`."
  if (ctx.params.stream_format === 'sse') {
    const input_tokens = estimateTokens(String(ctx.params.input));
    return ctx.sse([
      { data: { type: 'speech.audio.delta', audio: base64(r.audio) } },
      { data: { type: 'speech.audio.done', usage: { input_tokens, output_tokens: 0, total_tokens: input_tokens } } },
    ]);
  }
  return ctx.raw(new Uint8Array(r.audio), { headers: { 'content-type': r.type } });
}


