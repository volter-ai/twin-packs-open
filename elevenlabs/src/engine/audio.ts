// Audio the twin answers for speech it does not synthesize: real, playable silence in the format asked for, as long as
// the text would take to say, labeled where the format has room for a label. THE TWIN RUNS NO MODEL.
//
// Where the documentation stops and the twin decides: speech runs at about 15 characters a second; the channel is mono.
// PCM is 16-bit little-endian mono samples, all zero. An MP3 is MPEG Layer III frames whose side information is zero (each frame decodes to silence), after an ID3v2.3 tag
// whose title says what it is.

const CHARS_PER_SECOND = 15;
export const durationOf = (text: string): number => Math.max(0.5, text.length / CHARS_PER_SECOND);

const MPEG1 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MPEG2 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const RATES1 = [44100, 48000, 32000];
const RATES2 = [22050, 24000, 16000];
// the PCM rates ElevenLabs' output_format names (spec: text_to_speech_full's output_format)
const PCM_RATES = [8000, 16000, 22050, 24000, 32000, 44100, 48000];

function id3(title: string): Uint8Array<ArrayBuffer> {
  const text = new TextEncoder().encode(title.replace(/[^\x20-\x7e]/g, '?'));
  const frame = new Uint8Array(10 + 1 + text.length);
  frame.set(new TextEncoder().encode('TIT2'), 0);
  new DataView(frame.buffer).setUint32(4, 1 + text.length);
  frame.set(text, 11);
  const tag = new Uint8Array(10 + frame.length);
  tag.set([0x49, 0x44, 0x33, 3, 0, 0], 0);
  const n = frame.length;
  tag.set([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f], 6);
  tag.set(frame, 10);
  return tag;
}

function mp3(seconds: number, rate: number, kbps: number, title: string): Uint8Array<ArrayBuffer> {
  const v1 = RATES1.includes(rate);
  const bi = (v1 ? MPEG1 : MPEG2).indexOf(kbps);
  const si = (v1 ? RATES1 : RATES2).indexOf(rate);
  const perFrame = v1 ? 1152 : 576;
  const size = Math.floor(((v1 ? 144 : 72) * kbps * 1000) / rate);
  const frames = Math.ceil((seconds * rate) / perFrame);
  const head = id3(title);
  const out = new Uint8Array(head.length + frames * size);
  out.set(head, 0);
  for (let f = 0; f < frames; f++) out.set([0xff, v1 ? 0xfb : 0xf3, (bi << 4) | (si << 2), 0xc4], head.length + f * size);
  return out;
}

/** The audio for a text in an MP3 output format (`mp3_rate_bitrate`) or a PCM one (`pcm_rate`: 16-bit little-endian mono
 *  samples, silent), and its content type; undefined for any other: the applications ask for MP3 and PCM alone
 *  (journeys/demand.json), so the twin writes no other codec. Raw samples have no room for a label. */
export function silence(format: string, text: string, title: string): { bytes: Uint8Array<ArrayBuffer>; type: string } | undefined {
  const [codec, r, b] = format.split('_');
  const rate = Number(r);
  const seconds = durationOf(text);
  if (codec === 'mp3' && (RATES1.includes(rate) || RATES2.includes(rate)) && (RATES1.includes(rate) ? MPEG1 : MPEG2).includes(Number(b))) return { bytes: mp3(seconds, rate, Number(b), title), type: 'audio/mpeg' };
  if (codec === 'pcm' && b === undefined && PCM_RATES.includes(rate)) return { bytes: new Uint8Array(Math.ceil(seconds * rate) * 2), type: 'audio/pcm' };
  return undefined;
}

/** An agent's speech in its output format (`pcm_<rate>`: 16-bit little-endian mono samples, `ulaw_8000`: G.711 μ-law),
 *  silent and as long as the text would take to say, cut in one-second chunks as the conversation sends them; undefined
 *  for a format the agents do not speak. Raw samples have no room for a label: the agent's text says what it is. */
export function agentSpeech(format: string, text: string): Uint8Array[] | undefined {
  const [codec, r] = format.split('_');
  const rate = Number(r);
  if (!Number.isInteger(rate) || rate <= 0 || (codec !== 'pcm' && !(codec === 'ulaw' && rate === 8000))) return undefined;
  const width = codec === 'pcm' ? 2 : 1;
  const total = Math.ceil(durationOf(text) * rate) * width;
  const chunks: Uint8Array[] = [];
  for (let at = 0; at < total; at += rate * width) {
    // μ-law's silence is 0xFF; PCM's is zero
    const chunk = new Uint8Array(Math.min(rate * width, total - at));
    if (codec === 'ulaw') chunk.fill(0xff);
    chunks.push(chunk);
  }
  return chunks;
}

/** Bytes as base64 (an agent's audio travels so in its `audio_base_64`). */
export function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
