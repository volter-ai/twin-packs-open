// What Gmail's receiving server, its byte-stream door and its webmail share: the server's replies, a session's shape, the
// key the stream proves itself with, the mailboxes (Google's accounts, read from googleoauth: architecture A3) and the
// delivery of a message into them.
import { browserSessionToken, privateTransportKey, type HandlerContext, type smtpServer } from '@volter/world-core';
import { parse } from '../engine/mail.ts';

export type Row = Record<string, unknown>;

export const MESSAGE = 'message';

/** The domain whose accounts this server receives mail for: the descriptor's host rule names it, so the kernel's
 *  ctx.mail hands its mail here. */
export const MAIL_DOMAIN = 'gmail.com';

/** A session as its connection carries it between commands. */
export type Session = { stage: string; from?: string; rcpt: string[]; smtputf8?: boolean; greeted?: 'helo' | 'ehlo' };

/** What the front answers the stream: the reply lines, the session, and whether the stream reads a message next. */
export type WireAnswer = smtpServer.SmtpAnswer<Session>;

// Gmail's receiving server's replies. Google publishes its refusals in "Gmail SMTP errors and codes", each ending
// `gsmtp`; where the documentation stops: the page lists no successes and no refusal of a recipient at a domain Google
// does not receive for, so those replies' words are unverified (each is said so below), and the queue ids Gmail adds
// are left out.
// source: https://knowledge.workspace.google.com/admin/support/troubleshooting/gmail-smtp-errors-and-codes "gsmtp (Google SMTP) is added to all errors"
export const HOST = 'mx.google.com';
export const GREETING = `220 ${HOST} ESMTP - gsmtp`;
// the largest message the server takes, as its EHLO advertises SIZE (recalled, as above)
export const MAX_SIZE = 157_286_400;
export const OK_MAIL = '250 2.1.0 OK - gsmtp';
export const OK_RCPT = '250 2.1.5 OK - gsmtp';
export const OK = '250 2.0.0 OK - gsmtp';
export const GO_AHEAD = '354 Go ahead - gsmtp';
export const BYE = '221 2.0.0 closing connection - gsmtp';
export const UNRECOGNIZED = '502 5.5.1 Unrecognized command. - gsmtp';
// an address at gmail.com that is no account
// source: https://knowledge.workspace.google.com/admin/support/troubleshooting/gmail-smtp-errors-and-codes "The email account that you tried to reach does not exist."
export const NO_ACCOUNT = '550 5.1.1 The email account that you tried to reach does not exist. - gsmtp';
// an address at a domain this server does not receive for: an MX relays for no one. Unverified: Google's error page has
// no row for it, no published transcript of mx.google.com's reply to it was found, and a session to its MX from a
// residential connection could not be made (port 25 closed); no wording is claimed for it, the words below only stand in
export const NOT_OURS = '550 5.7.1 Relaying denied. - gsmtp';
// source: https://knowledge.workspace.google.com/admin/support/troubleshooting/gmail-smtp-errors-and-codes "Your message exceeded Google's message size limits."
export const TOO_BIG = '552 5.3.4 Your message exceeded Google\'s message size limits. - gsmtp';
// no certificate on the World's side port (ADR 0032 §4: IMAP and submission, which need TLS, are later cards)
export const NO_TLS = '454 4.7.0 TLS not available - gsmtp';
// source: spec:4.1.1.11 "command, it will return code 555."
export const unsupported = (arg: string): string => `555 5.5.4 Unsupported option: ${arg} - gsmtp`;
export const SYNTAX = '501 5.5.2 Syntax error. - gsmtp';
// The host cannot persist a message: a temporary failure, as RFC 5321 names it.
// source: spec:4.2.3 "451 Requested action aborted: local error in processing"
const queueFailure = (session: Session): WireAnswer => ({ replies: ['451 4.3.0 Local error in processing - gsmtp'], session, mode: 'command', close: true });

/** The bridge between a connection and the server's front (world-core's SMTP server machine): the header the stream
 *  signs its requests with, a key made once per process so a request from outside it (the webmail's port) cannot speak
 *  for a connection, a fresh session, and the server's local-error reply. */
export const BRIDGE: smtpServer.SmtpBridge<Session> = { header: 'x-volter-gmail-wire', key: () => privateTransportKey('gmail'), fresh: () => ({ stage: 'fresh', rcpt: [] }), failure: queueFailure };


type Reader = Pick<HandlerContext, 'ownerRow'>;

/** The mailbox an address names: the address of the Google account whose sign-up recorded its person (googleoauth's
 *  `_person`, keyed `person:<email>`, with the account's `sub`, whose `account` stands); a `+tag` reaches the same
 *  mailbox, as Gmail delivers it. Where the
 *  documentation stops: Gmail also ignores dots in the local part; the twin matches the address as signed up. */
export function accountOf(ctx: Reader, address: string): string | undefined {
  const lower = address.toLowerCase();
  const plain = lower.replace(/\+[^@]*@/, '@');
  for (const email of lower === plain ? [lower] : [lower, plain]) {
    const person = ctx.ownerRow('googleoauth', '_person', `person:${email}`);
    const sub = typeof person?.sub === 'string' && person.deleted !== true ? person.sub : undefined;
    const account = sub ? ctx.ownerRow('googleoauth', 'account', sub) : undefined;
    if (sub && account && account.deleted !== true) return email;
  }
  return undefined;
}

/** A message accepted: kept once in each recipient's mailbox, with its envelope, its bytes and what they parse to. */
export async function deliver(ctx: HandlerContext, e: { from: string; to: string[]; data: string; smtputf8: boolean }): Promise<void> {
  const p = parse(e.data);
  for (const rcpt of e.to) {
    const mailbox = accountOf(ctx, rcpt);
    if (!mailbox) continue;
    const id = ctx.mint(MESSAGE);
    const rawKey = `${id}/raw`;
    await ctx.blobs.put(rawKey, Uint8Array.from(e.data, (c) => c.charCodeAt(0) & 0xff));
    const attachmentKeys: string[] = [];
    for (let i = 0; i < p.attachments.length; i++) {
      const key = `${id}/attachments/${i}`;
      await ctx.blobs.put(key, Uint8Array.from(atob(p.attachments[i]!.base64), (c) => c.charCodeAt(0)));
      attachmentKeys.push(key);
    }
    await ctx.write(MESSAGE, id, {
      id, mailbox, envelope: { from: e.from, to: rcpt, smtputf8: e.smtputf8 }, size: e.data.length, receivedAt: ctx.occurredAt,
      headers: p.headers, subject: p.subject, from: p.from, to: p.to, cc: p.cc, text: p.text, html: p.html,
      attachments: p.attachments.map(({ base64: _b, ...a }) => a), labelIds: ['INBOX', 'UNREAD'], _raw: rawKey, _attachments: attachmentKeys,
    }, 'message.deliver');
  }
}

/** The SID cookie Google's sign-in sets on .google.com (googleoauth's contract). */
const SESSION_COOKIE = 'SID';
/** The mailbox of the Google account a request's browser is signed in to: its `SID` cookie names a session googleoauth
 *  recorded (`_web_session`, keyed `websession:<token>`), whose person is the account's. */
export function signedInAccount(ctx: HandlerContext): string | undefined {
  const token = browserSessionToken(ctx.call.request, SESSION_COOKIE);
  if (!token) return undefined;
  const session = ctx.ownerRow('googleoauth', '_web_session', `websession:${token}`);
  if (!session || session.token !== token || typeof session.email !== 'string') return undefined;
  return accountOf(ctx, session.email);
}
