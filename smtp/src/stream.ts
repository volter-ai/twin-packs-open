// THE RELAY'S BYTE-STREAM DOOR (world-core's TwinStream): a connection's bytes framed as SMTP frames them, each piece
// handed to the pack's front (./semantics/around.ts) with the session the connection carries. Commands are lines ended by
// CRLF; after a 354, the message's lines up to the lone dot, their leading dot removed (RFC 5321 §4.5.2); after a 334,
// one line of AUTH response. The host carries the bytes: a local listener's socket (./server.ts), or a WebSocket to a
// hosted World. Commands a client pipelines are answered in order.
// source: spec:4.1.1.4 "In particular, the sequence \"<LF>.<LF>\" (bare line feeds, without carriage returns) MUST NOT be treated as equivalent to <CRLF>.<CRLF> as the end of mail data indication."
// source: spec:4.5.2 "If the first character is a period and there are other characters on the line, the first character is deleted."
import type { PackFetchOptions, TwinStream } from '@volter/world-core';
import { createSmtpFetch } from './fetch.ts';
import { freshSession, queueFailure, type Session, WIRE_HEADER, type WireAnswer, wireKey } from './semantics/shared.ts';

export function createSmtpTwinStream(options: PackFetchOptions = {}): TwinStream {
  const fetch = createSmtpFetch(options);
  return (sink, peer) => {
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    let buffer = '';
    let session: Session = freshSession();
    let mode: WireAnswer['mode'] = 'command';
    let data: string[] = [];
    let closed = false;
    let chain: Promise<void> = Promise.resolve();

    const post = async (body: Record<string, unknown>): Promise<void> => {
      if (closed) return;
      let a: WireAnswer;
      try {
        const res = await fetch(new Request('http://smtp.wire/', { method: 'POST', headers: { 'content-type': 'application/json', [WIRE_HEADER]: wireKey(), 'x-forwarded-for': peer }, body: JSON.stringify({ session, ...body }) }));
        a = res.ok ? (await res.json()) as WireAnswer : queueFailure(session);
        if (!Array.isArray(a.replies) || !a.session || !['command', 'data', 'auth'].includes(a.mode)) a = queueFailure(session);
      } catch { a = queueFailure(session); }
      session = a.session;
      mode = a.mode;
      sink.write(encoder.encode(a.replies.map((r) => `${r}\r\n`).join('')));
      if (a.close) { closed = true; sink.end(); }
    };

    const line = async (text: string): Promise<void> => {
      if (mode === 'data') {
        if (text === '.') { const message = data.join('\r\n') + (data.length ? '\r\n' : ''); data = []; mode = 'command'; await post({ data: message }); return; }
        data.push(text.startsWith('.') ? text.slice(1) : text);
        return;
      }
      if (mode === 'auth') { await post({ response: text }); return; }
      await post({ line: decoder.decode(Uint8Array.from(text, (c) => c.charCodeAt(0))) });
    };

    const pump = (): void => {
      let at: number;
      while ((at = buffer.indexOf('\r\n')) >= 0) {
        const text = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        chain = chain.then(() => line(text));
      }
    };

    chain = chain.then(() => post({ open: true }));
    return {
      data(chunk) { if (closed) return; buffer += Array.from(chunk, (b) => String.fromCharCode(b)).join(''); pump(); },
      settled: () => chain,
      close() { closed = true; },
    };
  };
}
