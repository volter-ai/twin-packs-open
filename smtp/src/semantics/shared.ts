// What the relay's front, its door and its byte-stream door share: its replies (Postfix's, as its smtpd answers them),
// its policy, a session's shape, and the key the stream proves itself with.
import { privateTransportKey, type HandlerContext, type smtpServer } from '@volter/world-core';

export type Row = Record<string, unknown>;

const MESSAGE = 'message';
export const RELAY = 'relay';

/** The relay's policy, as the `relay` door set it; an open relay until it is set. */
export type Policy = { hostname: string; auth?: { username: string; password: string }; senderDomains?: string[]; relayDomains?: string[]; maxSize: number; localRecipients?: string[] };

// Postfix's default message_size_limit (10240000 bytes)
// source: https://www.postfix.org/postconf.5.html "message_size_limit (default: 10240000)"
const DEFAULT_MAX_SIZE = 10_240_000;

export function policyOf(ctx: Pick<HandlerContext, 'rowsRaw'>): Policy {
  const r = ctx.rowsRaw(RELAY).find((x) => x.id === 'relay' && x.deleted !== true);
  return {
    hostname: typeof r?.hostname === 'string' ? r.hostname : 'relay.world.test',
    ...(r?.auth && typeof r.auth === 'object' ? { auth: r.auth as Policy['auth'] & object } : {}),
    ...(Array.isArray(r?.senderDomains) ? { senderDomains: r.senderDomains as string[] } : {}),
    ...(Array.isArray(r?.relayDomains) ? { relayDomains: r.relayDomains as string[] } : {}),
    ...(Array.isArray(r?.localRecipients) ? { localRecipients: r.localRecipients as string[] } : {}),
    maxSize: typeof r?.maxSize === 'number' ? r.maxSize : DEFAULT_MAX_SIZE,
  };
}

/** A session as its connection carries it between commands. */
export type Session = {
  stage: string;
  authenticated: 'false' | 'true';
  user?: string;
  from?: string;
  rcpt: string[];
  smtputf8?: boolean;
  /** an AUTH exchange under way: its mechanism and the user a LOGIN has given */
  auth?: { mechanism: 'PLAIN' | 'LOGIN'; user?: string };
  /** the stage a transaction returns to: the greeting it began from */
  greeted?: 'helo' | 'ehlo';
};

const freshSession = (): Session => ({ stage: 'fresh', authenticated: 'false', rcpt: [] });

/** What the front answers the stream: the reply lines, the session, and whether the stream reads a message next
 *  (`data`), an AUTH response (`auth`) or commands, or closes. */
export type WireAnswer = smtpServer.SmtpAnswer<Session>;

/** The key the pack's byte-stream door signs its requests with: made once per process, so a request from outside the
 *  process (the control port) cannot speak for a connection. */
const wireKey = (): string => privateTransportKey('smtp');

// Postfix's replies (smtpd.c, smtpd_sasl_proto.c, smtpd_sasl_glue.c, smtpd_check.c at postfix's master).
// source: https://raw.githubusercontent.com/vdukhovni/postfix/master/postfix/src/smtpd/smtpd.c "250 2.1.0 Ok"
export const OK_MAIL = '250 2.1.0 Ok';
// source: https://raw.githubusercontent.com/vdukhovni/postfix/master/postfix/src/smtpd/smtpd.c "250 2.1.5 Ok"
export const OK_RCPT = '250 2.1.5 Ok';
// source: https://raw.githubusercontent.com/vdukhovni/postfix/master/postfix/src/smtpd/smtpd.c "250 2.0.0 Ok"
export const OK = '250 2.0.0 Ok';
// source: https://raw.githubusercontent.com/vdukhovni/postfix/master/postfix/src/smtpd/smtpd.c "354 End data with <CR><LF>.<CR><LF>"
export const GO_AHEAD = '354 End data with <CR><LF>.<CR><LF>';
// source: https://raw.githubusercontent.com/vdukhovni/postfix/master/postfix/src/smtpd/smtpd.c "250 2.0.0 Ok: queued as %s"
export const queued = (id: string): string => `250 2.0.0 Ok: queued as ${id}`;
// source: https://raw.githubusercontent.com/vdukhovni/postfix/master/postfix/src/smtpd/smtpd.c "221 2.0.0 Bye"
export const BYE = '221 2.0.0 Bye';
// source: https://raw.githubusercontent.com/vdukhovni/postfix/master/postfix/src/smtpd/smtpd.c "500 5.5.2 Error: command not recognized"
export const UNRECOGNIZED = '500 5.5.2 Error: command not recognized';
// source: https://raw.githubusercontent.com/vdukhovni/postfix/master/postfix/src/smtpd/smtpd.c "502 5.5.1 VRFY command is disabled"
export const NO_VRFY = '502 5.5.1 VRFY command is disabled';
// source: https://raw.githubusercontent.com/vdukhovni/postfix/master/postfix/src/smtpd/smtpd.c "454 4.7.0 TLS not available due to local problem"
export const NO_TLS = '454 4.7.0 TLS not available due to local problem';
// source: https://raw.githubusercontent.com/vdukhovni/postfix/master/postfix/src/smtpd/smtpd.c "501 5.5.4 Syntax: MAIL FROM:<address>"
export const MAIL_SYNTAX = '501 5.5.4 Syntax: MAIL FROM:<address>';
// source: https://raw.githubusercontent.com/vdukhovni/postfix/master/postfix/src/smtpd/smtpd.c "501 5.1.7 Bad sender address syntax"
export const BAD_SENDER = '501 5.1.7 Bad sender address syntax';
// source: https://raw.githubusercontent.com/vdukhovni/postfix/master/postfix/src/smtpd/smtpd.c "501 5.5.4 Bad message size syntax"
export const BAD_SIZE = '501 5.5.4 Bad message size syntax';
// source: https://raw.githubusercontent.com/vdukhovni/postfix/master/postfix/src/smtpd/smtpd.c "555 5.5.4 Unsupported option: %s"
export const unsupported = (arg: string): string => `555 5.5.4 Unsupported option: ${arg}`;
// source: https://raw.githubusercontent.com/vdukhovni/postfix/master/postfix/src/smtpd/smtpd.c "501 5.5.4 Syntax: RCPT TO:<address>"
export const RCPT_SYNTAX = '501 5.5.4 Syntax: RCPT TO:<address>';
// source: https://raw.githubusercontent.com/vdukhovni/postfix/master/postfix/src/smtpd/smtpd.c "501 5.1.3 Bad recipient address syntax"
export const BAD_RECIPIENT = '501 5.1.3 Bad recipient address syntax';
// source: https://raw.githubusercontent.com/vdukhovni/postfix/master/postfix/src/smtpd/smtpd_check.c "Message size exceeds fixed limit"
export const TOO_BIG = '552 5.3.4 Message size exceeds fixed limit';
// source: https://raw.githubusercontent.com/vdukhovni/postfix/master/postfix/src/smtpd/smtpd_check.c "<%s>: Relay access denied"
export const relayDenied = (rcpt: string): string => `554 5.7.1 <${rcpt}>: Relay access denied`;
// source: https://raw.githubusercontent.com/vdukhovni/postfix/master/postfix/src/smtpd/smtpd_check.c "<%s>: Sender address rejected: not owned by user %s"
export const notOwned = (sender: string, user: string): string => `553 5.7.1 <${sender}>: Sender address rejected: not owned by user ${user}`;
/** A sender outside the relay's domains from a client that has not authenticated: refused as a sender access table
 *  refuses it (check_sender_access REJECT). */
// source: https://raw.githubusercontent.com/vdukhovni/postfix/master/postfix/src/smtpd/smtpd_check.c "<%s>: %s rejected: Access denied"
export const senderDenied = (sender: string): string => `554 5.7.1 <${sender}>: Sender address rejected: Access denied`;
// source: https://www.rfc-editor.org/rfc/rfc4954 "530 5.7.0 Authentication required"
export const AUTH_REQUIRED = '530 5.7.0 Authentication required';
// source: https://raw.githubusercontent.com/vdukhovni/postfix/master/postfix/src/smtpd/smtpd_sasl_proto.c "503 5.5.1 Error: authentication not enabled"
export const AUTH_OFF = '503 5.5.1 Error: authentication not enabled';
// source: https://raw.githubusercontent.com/vdukhovni/postfix/master/postfix/src/smtpd/smtpd_sasl_proto.c "501 5.5.4 Syntax: AUTH mechanism"
export const AUTH_SYNTAX = '501 5.5.4 Syntax: AUTH mechanism';
// source: https://raw.githubusercontent.com/vdukhovni/postfix/master/postfix/src/smtpd/smtpd_sasl_glue.c "235 2.7.0 Authentication successful"
export const AUTH_OK = '235 2.7.0 Authentication successful';
// source: https://raw.githubusercontent.com/vdukhovni/postfix/master/postfix/src/smtpd/smtpd_sasl_glue.c "535 5.7.8 Error: authentication failed: %s"
export const authFailed = (why: string): string => `535 5.7.8 Error: authentication failed: ${why}`;
// source: https://raw.githubusercontent.com/vdukhovni/postfix/master/postfix/src/smtpd/smtpd_sasl_glue.c "501 5.7.0 Authentication aborted"
export const AUTH_ABORTED = '501 5.7.0 Authentication aborted';
// an unknown mechanism: RFC 4954's 504
// source: https://www.rfc-editor.org/rfc/rfc4954 "the server rejects the AUTH command with a 504 reply"
const UNKNOWN_MECHANISM = '504 5.5.4 Unrecognized authentication type';


/** A message accepted: handed to each recipient's mailbox provider through the kernel's ctx.mail (ADR 0032 §3), as
 *  a relay hands it to the server of each recipient's domain, and kept as its queue keeps it: its envelope, its size and
 *  each recipient's reply (`250` delivered, `5xx` refused, a domain no twin receives refused by the kernel); its id is the
 *  queue id the 250 names. Where the twin stops: a recipient refused after the 250 gets no bounce message yet (RFC 3464;
 *  ADR 0032, a later card), the reply is recorded. */
export async function deliver(ctx: HandlerContext, e: { from: string; to: string[]; data: string; smtputf8: boolean; user?: string }): Promise<string> {
  const id = ctx.mint(MESSAGE).toUpperCase();
  const replies = await ctx.mail({ from: e.from, to: e.to, raw: Uint8Array.from(e.data, (c) => c.charCodeAt(0) & 0xff) });
  await ctx.write(MESSAGE, id, {
    id, envelope: { from: e.from, to: e.to, smtputf8: e.smtputf8, ...(e.user ? { authenticatedAs: e.user } : {}) }, size: e.data.length, receivedAt: ctx.occurredAt,
    replies: replies.map(({ to, code, reply }) => ({ to, code, reply })),
  }, 'message.deliver');
  return id;
}

// An optional SASL initial response: nodemailer uses a challenge for LOGIN, but other clients may supply one.
// source: https://www.rfc-editor.org/rfc/rfc4954 "initial-response"
function loginInitial(s: Session, initial: string): WireAnswer {
  let user: string;
  try { user = atob(initial.trim()); } catch { return { replies: [authFailed('Invalid base64 data in initial response')], session: s, mode: 'command' }; }
  return { replies: ['334 UGFzc3dvcmQ6'], session: { ...s, auth: { mechanism: 'LOGIN', user } }, mode: 'auth' };
}

// The host cannot persist a message: its failure remains a temporary SMTP processing failure.
// source: spec:4.2.3 "451 Requested action aborted: local error in processing"
function queueFailure(session: Session): WireAnswer {
  return { replies: ['451 4.3.0 Error: queue file write error'], session, mode: 'command', close: true };
}

/** The bridge between a connection and the relay's front (world-core's SMTP server machine): the header the stream signs
 *  its requests with, a key made once per process so a request from outside it (the policy port) cannot speak for a
 *  connection, a fresh session, and the relay's local-error reply. */
export const BRIDGE: smtpServer.SmtpBridge<Session> = { header: 'x-volter-smtp-wire', key: wireKey, fresh: freshSession, failure: queueFailure };

// source: https://www.rfc-editor.org/rfc/rfc4954 "the server rejects the AUTH command with a 504 reply"
function unknownAuth(session: Session): WireAnswer {
  return { replies: [UNKNOWN_MECHANISM], session, mode: 'command' };
}
// source: https://raw.githubusercontent.com/vdukhovni/postfix/master/postfix/src/smtpd/smtpd.c "500 5.5.2 Error: command not recognized"
export function unknownCommand(session: Session): WireAnswer {
  return { replies: [UNRECOGNIZED], session, mode: 'command' };
}
const loginChallenge = (s: Session): WireAnswer => ({ replies: ['334 VXNlcm5hbWU6'], session: { ...s, auth: { mechanism: 'LOGIN' } }, mode: 'auth' });

// Optional non-PLAIN mechanisms: this relay advertises PLAIN first; the application's default selects it.
// source: https://www.rfc-editor.org/rfc/rfc4954 "initial-response"
export function otherAuth(s: Session, mechanism: string, initial?: string): WireAnswer {
  return mechanism.toUpperCase() === 'LOGIN' ? (initial !== undefined ? loginInitial(s, initial) : loginChallenge(s)) : unknownAuth(s);
}
