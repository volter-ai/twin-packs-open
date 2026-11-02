// Decode generated PNG headers for assertions about the bytes an application receives.
import { arr, obj } from './shared.ts';

export const answerViews = {
  png: (body: unknown): unknown => {
    const b = obj(body);
    return { ...b, candidates: arr(b.candidates).map((candidate) => {
      const content = obj(candidate.content);
      return { ...candidate, content: { ...content, parts: arr(content.parts).map((part) => {
        const inline = obj(part.inlineData);
        if (inline.mimeType !== 'image/png') return part;
        const bytes = Buffer.from(String(inline.data), 'base64');
        return { ...part, inlineData: { ...inline, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), labeled: bytes.includes(Buffer.from('[twin-stub]')) } };
      }) } };
    }) };
  },
};
