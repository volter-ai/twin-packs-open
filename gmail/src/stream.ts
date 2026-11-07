// GMAIL'S RECEIVING SERVER'S BYTE-STREAM DOOR (world-core's TwinStream): a connection's bytes framed and carried to the
// server's front (./semantics/around.ts) by the kernel's SMTP server machine (`smtpServer.smtpStream`, RFC 5321
// §4.1.1.4 and §4.5.2). The host carries the bytes: a local listener's socket on the pack's SMTP side port (./server.ts),
// or the World's sender in process (a journey walk's companion).
import { smtpServer, type PackFetchOptions, type TwinStream } from '@volter/world-core';
import { createGmailFetch } from './fetch.ts';
import { BRIDGE } from './semantics/shared.ts';

export function createGmailTwinStream(options: PackFetchOptions = {}): TwinStream {
  return smtpServer.smtpStream(createGmailFetch(options), BRIDGE);
}
