// SMTP's manifest: a mail relay (a submission server, as Postfix serves one) on a raw TCP socket.
//
// THE SURFACE is generated (./generated/surface.gen.json): RFC 5321's command-reply table, derived from the vendored
// RFC; ../spec/patches.json adds what the extensions this relay speaks say (AUTH, STARTTLS, 530, 554).
//
// SCOPE FROM THE DEMAND (../journeys/demand.json). Every application sends with nodemailer: the greeting, EHLO (HELO
// when refused), AUTH with the first mechanism advertised, MAIL with SIZE, BODY=8BITMIME and SMTPUTF8, one RCPT per
// recipient, DATA, QUIT; Twenty's pool resets a session between messages (RSET) and verifies a mailbox (EHLO, AUTH,
// QUIT). The pack's front (./semantics/around.ts) runs each command; VRFY, EXPN and HELP are refused as Postfix refuses
// them. STARTTLS and implicit TLS are the gap: LibreChat asks for them only when told to.
//
// THE WIRE. A connection's bytes arrive through the pack's byte-stream door (../stream.ts), which frames them into
// commands and a message's lines and hands each to the front. A session lives on its connection, never in the World's
// tree: the stream carries it and the front moves it, asking this machine for every command, so the declaration is the
// rule and not a description of it.
//
// THE STATE is what the relay is and what it delivered: its policy (`relay`: its hostname, the credentials it requires,
// the sender domains it accepts, the domains it relays to without them, its size limit), set through the World's door
// as an operator sets Postfix's; and each message it accepted (`message`: its envelope, its bytes, its parsed parts),
// which the World's inspect doors read and delete.
import type { DerivedManifest } from '@volter/world-core';
import { states } from './semantics/states.ts';

export const manifest: DerivedManifest = {
  vendor: 'smtp',
  service: 'smtp',
  discovery: {
    twinOf: 'an SMTP submission relay as Postfix serves one (RFC 5321, with AUTH, SIZE, 8BITMIME and SMTPUTF8)',
    identity: 'SMTP AUTH PLAIN/LOGIN uses the credentials configured through POST /_twin/relay; without configured credentials, the relay accepts mail without authentication and AUTH is disabled (503). Inspect doors need no credential.',
    stores: 'the relay\'s policy and every message it accepted, with its envelope, its bytes and its parsed parts',
  },
  body: { json: 'always' },
  ids: { template: '{letters:10}' },
  time: 'iso',
  // the doors' refusals; the wire answers in SMTP replies (./semantics/shared.ts)
  error: { error: '{message}' },
  readOnly: { status: 403, message: 'the twin is read-only' },
  notFound: { status: 404, message: 'no such message' },
  list: { style: 'envelope', envelope: { messages: '{data}' }, limit: { param: 'limit', default: 50, max: 500 } },
  deleted: {},
  vendorBacked: { none: 'SMTP is a line protocol: messages are submitted over a connection; there is no derived HTTP perform or vendor resource refresh.' },
  unmodeled: ['EXPN', 'HELP'],
  resources: {
    Session: { storedAs: '_session', refresh: { none: 'Connection-local state, not a vendor resource.' }, idPrefix: 'session', ...states.Session },
    message: { refresh: { none: 'SMTP has no operation for retrieving accepted mail; the inspect doors read local capture only.' }, idPrefix: '', ids: '{letters:10}' },
    relay: { idPrefix: '', refresh: { none: 'Operator policy, not an SMTP resource.' } },
  },
  doors: [
    { id: 'relay', method: 'POST', path: '/_twin/relay', note: '{ hostname?, auth?: { username, password }, senderDomains?, relayDomains?, maxSize?, localRecipients? }: the relay\'s policy, as its operator configures it; an empty body makes it an open relay' },
    { id: 'messages', method: 'GET', path: '/_twin/messages', note: '?to=&from=&q=: the messages the relay accepted, newest first' },
    { id: 'message', method: 'GET', path: '/_twin/messages/{id}', note: 'one message: its envelope, headers, text, HTML and attachments' },
    { id: 'raw', method: 'GET', path: '/_twin/messages/{id}/raw', note: 'the message\'s bytes as the client sent them' },
    { id: 'attachment', method: 'GET', path: '/_twin/messages/{id}/attachments/{index}', note: 'one attachment\'s bytes' },
    { id: 'remove', method: 'DELETE', path: '/_twin/messages/{id}', note: 'one message deleted' },
    { id: 'clear', method: 'DELETE', path: '/_twin/messages', note: 'every message deleted' },
  ],
  descriptor: {
    protocol: '3',
    transport: 'raw-tcp',
    archetype: 'crud',
    bin: 'world-smtp',
    resources: ['message', 'relay'],
    specSource: 'spec/rfc5321.txt (RFC 5321), with spec/patches.json from RFC 4954 (AUTH), RFC 3207 (STARTTLS) and Postfix\'s documented replies',
    description: 'SMTP relay twin — the submission server nodemailer sends to (EHLO, AUTH PLAIN/LOGIN, MAIL with SIZE, 8BITMIME and SMTPUTF8, RCPT, DATA, RSET, QUIT, with Postfix\'s replies), keeping every accepted message in the World, read and deleted through its inspect doors. Nothing is put on the wire.',
    adoption: { pypi: ['aiosmtplib'], sdks: ['nodemailer', 'nodemailer-smtp-transport', 'emailjs'], envStems: ['NEXTPRIVATESMTP'] },
    hostsNone: 'RAW-PROTOCOL pack: SMTP is a line protocol over a raw TCP socket, invisible to the http/fetch injector, and the relay is whatever host the operator names. The World injects SMTP_HOST/SMTP_PORT, EMAIL_SERVER_HOST/EMAIL_SERVER_PORT and EMAIL_SERVER at the twin\'s listener (world-runtime init.ts).',
    endpointEnvNone: 'the relay is named by host and port settings the runtime injects as templates (world-runtime init.ts), not a base URL',
    sidePorts: [{ name: 'inspect', option: 'inspectPort', flag: '--inspect-port', path: '/_twin/messages', note: 'the World\'s inspect doors: the messages the relay accepted' }],
  },
};
