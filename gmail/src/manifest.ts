// Gmail's manifest (ADR 0032 §4): the mail half of a Google account. A message sent to an address at gmail.com reaches
// Gmail's receiving server (gmail.com's MX) over SMTP, which accepts it for an account Google holds and refuses it for
// any other; the person reads it in Gmail's webmail at mail.google.com, signed in to Google.
//
// THE SURFACE is generated (./generated/surface.gen.json): RFC 5321's command-reply table, the receiving server's, served
// on the pack's SMTP side port. The front (./semantics/around.ts) runs each command a connection's byte-stream door
// (../stream.ts) hands it. The Gmail API, IMAP and submission are later cards (ADR 0032, Staging).
//
// THE STATE is each mailbox's messages (`message`: its mailbox, its envelope, its bytes and what they parse to). The
// mailboxes are Google's accounts: googleoauth owns them and Google's sign-in, and this pack reads them through the
// kernel's cross-pack read (`ownerReads`, architecture A3), never writes them: a person who signed up (`_person`, keyed
// `person:<email>`, with the account's `sub`), the account (`account` <sub>) and the browser's Google session
// (`_web_session`, keyed `websession:<the SID cookie>`).
//
// THE ADDRESSING is a static vendor fact: the descriptor's host rules name gmail.com, and its side port's scheme is
// `smtp`, so the kernel's `ctx.mail` hands a gmail.com recipient's mail here (world-core smtp.ts, ADR 0032 §3).
import type { DerivedManifest } from '@volter/world-core';
import { states } from './semantics/states.ts';

export const manifest: DerivedManifest = {
  vendor: 'gmail',
  service: 'gmail',
  discovery: {
    twinOf: "Gmail: its receiving SMTP server (gmail.com's MX) and its webmail at mail.google.com",
    identity: "The SMTP side port takes mail from any sender, as an MX does, for gmail.com accounts Google holds. Webmail reads the person's Google session (googleoauth's SID cookie).",
    stores: "each Google account's mailbox: the messages it received, with their envelope, bytes, headers, bodies and attachments",
  },
  body: { json: 'always' },
  ids: { template: '{letters:16}' },
  time: 'iso',
  // the screens' and the wire's refusals; the wire answers in SMTP replies (./semantics/shared.ts)
  error: { error: '{message}' },
  readOnly: { status: 403, message: 'the twin is read-only' },
  notFound: { status: 404, message: 'Not Found' },
  list: { style: 'envelope', envelope: { messages: '{data}' }, limit: { param: 'limit', default: 50, max: 500 } },
  deleted: {},
  vendorBacked: { none: 'Mail reaches Gmail over SMTP from a sending twin inside the World; there is no derived HTTP perform or vendor resource refresh (the Gmail API is a later card).' },
  unmodeled: ['EXPN', 'HELP'],
  // who a message's records name (ADR 0036, "Replicating an issue"): its mailbox, the Google account it was kept for,
  // and its envelope's addresses; the recipient as Gmail delivers it, where `local+tag@gmail.com` is the mailbox
  // `local@gmail.com` labelled (shared.ts accountOf), so a fork keeps the tag on the mailbox's pseudonym (`email+`)
  privacy: {
    identifiers: {
      message: { mailbox: 'email', 'envelope.to': 'email+', 'envelope.from': 'email', receivedAt: 'time' },
    },
    questions: [],
  },
  ownerReads: [
    { owner: 'googleoauth', resource: '_person' },
    { owner: 'googleoauth', resource: 'account' },
    { owner: 'googleoauth', resource: '_web_session' },
  ],
  resources: {
    Session: { storedAs: '_session', refresh: { none: 'Connection-local state, not a vendor resource.' }, idPrefix: 'session', ...states.Session },
    message: { refresh: { none: 'The Gmail API, which would read a mailbox back, is a later card.' }, idPrefix: '', ids: '{letters:16}' },
  },
  screens: [{
    // Gmail's webmail (screens/mail.ts): the signed-in person's inbox, a message with its links, and its attachments
    id: 'mail', kind: 'workspace', host: 'mail.google.com', path: '/mail',
    demand: "a person reads the mail an application sent them (Rallly's invitation with its invite.ics, Dub's links) and follows its link", status: 'done',
    controls: ['Inbox', 'Download'], source: 'https://support.google.com/mail/answer/8494',
  }, {
    // gmail.com itself, which sends a visitor to the webmail
    id: 'home', kind: 'flow', host: 'gmail.com', path: '/',
    demand: 'a person who opens gmail.com reaches their inbox', status: 'done',
    source: 'https://support.google.com/mail/answer/8494',
  }],
  descriptor: {
    protocol: '3',
    transport: 'rest',
    archetype: 'crud',
    bin: 'world-gmail',
    resources: ['message'],
    specSource: "spec/rfc5321.txt (RFC 5321): the command-reply table of Gmail's receiving server (spec/SOURCE.md)",
    description: "Gmail twin — gmail.com's receiving SMTP server, which keeps mail for the World's Google accounts and refuses other addresses, and the webmail at mail.google.com where the signed-in person reads it and downloads its attachments.",
    adoption: { sdks: [], envStems: [] },
    // gmail.com: the domain whose mail this server receives (the kernel's ctx.mail routes by it), and its site; the
    // webmail's host
    hosts: [{ host: 'mail.google.com' }, { host: 'gmail.com' }],
    endpointEnvNone: 'no application reads Gmail by a base URL: mail reaches it from the World\'s senders (ctx.mail), and a person opens its webmail',
    // a gmail.com address is a Google account, made at Google's own sign-up (googleoauth's accounts.google.com/signup,
    // which leaves the person signed in): the door the World's generated seed calls for each declared person whose
    // address this pack's mail domain is (ADR 0033 §3)
    seed: { signUp: 'https://accounts.google.com/signup' },
    sidePorts: [{ name: 'smtp', option: 'smtpPort', flag: '--smtp-port', scheme: 'smtp', note: "Gmail's receiving SMTP server (gmail-smtp-in.l.google.com), without TLS: mail for gmail.com's accounts, handed on by the World's senders through ctx.mail" }],
  },
};
