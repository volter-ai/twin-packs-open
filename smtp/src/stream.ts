// THE RELAY'S BYTE-STREAM DOOR (world-core's TwinStream): a connection's bytes framed and carried to the relay's front
// (./semantics/around.ts) by the kernel's SMTP server machine (`smtpServer.smtpStream`: commands, a message's data and
// AUTH responses, RFC 5321 §4.1.1.4 and §4.5.2). The host carries the bytes: a local listener's socket (./server.ts), or
// a WebSocket to a hosted World.
import { smtpServer, type PackFetchOptions, type TwinStream } from '@volter/world-core';
import { createSmtpFetch } from './fetch.ts';
import { BRIDGE } from './semantics/shared.ts';

export function createSmtpTwinStream(options: PackFetchOptions = {}): TwinStream {
  return smtpServer.smtpStream(createSmtpFetch(options), BRIDGE);
}
