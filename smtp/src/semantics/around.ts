// THE RELAY'S FRONT: each command a connection sends, run as RFC 5321 orders it and Postfix answers it. The pack's
// byte-stream door (../stream.ts) frames a connection's bytes and posts each command (or a message's whole data, or an
// AUTH response) here with the session it carries; the answer is the reply lines, the moved session, and what the stream
// reads next. Every other request is the World's doors'.
//
// A command's order is the manifest's session machine (`ctx.legal`). The policy is the relay's (`relay`, ./shared.ts):
// with credentials set it advertises AUTH PLAIN LOGIN and a sender must authenticate (RFC 4954's 530); with sender
// domains, a sender's address must be one of them (not owned by the authenticated user, or access denied); with relay
// domains, an unauthenticated recipient outside them is refused (reject_unauth_destination); its size limit is advertised
// (SIZE) and holds against a declared size and the data itself.
// Where Postfix's defaults decide: EHLO's keywords (PIPELINING, SIZE, ENHANCEDSTATUSCODES, 8BITMIME, SMTPUTF8, and AUTH
// when enabled), VRFY disabled, and STARTTLS not available (no certificate: the gap).
import { smtpServer, type HandlerContext } from '@volter/world-core';
import {
  AUTH_ABORTED, AUTH_OFF, AUTH_OK, AUTH_REQUIRED, AUTH_SYNTAX, authFailed, BAD_RECIPIENT, BAD_SENDER, BAD_SIZE, BRIDGE, BYE, deliver, GO_AHEAD, MAIL_SYNTAX,
  NO_TLS, NO_VRFY, notOwned, OK, OK_MAIL, OK_RCPT, policyOf, type Policy, queued, RCPT_SYNTAX, relayDenied, senderDenied, type Session, TOO_BIG, unsupported,
  UNRECOGNIZED, otherAuth, unknownCommand, type WireAnswer,
} from './shared.ts';

const { smtpCleared, smtpCommand, smtpDomain: domainOf, smtpEhlo, smtpFront, smtpMailFrom, smtpOrder, smtpRcptTo } = smtpServer;

const cmd = (session: Session, ...replies: string[]): WireAnswer => ({ replies, session, mode: 'command' });

/** The machine's word on a command from where the session stands: a refusal's reply, or undefined to go on. */
const order = (ctx: HandlerContext, s: Session, op: string, to?: string): string | undefined => smtpOrder(ctx, 'Session', s.stage, op, to);

const ehlo = (p: Policy): string[] => smtpEhlo([p.hostname, 'PIPELINING', `SIZE ${p.maxSize}`, ...(p.auth ? ['AUTH PLAIN LOGIN'] : []), 'ENHANCEDSTATUSCODES', '8BITMIME', 'SMTPUTF8']);

/** A transaction's state cleared, the greeting and the session's authentication kept (RSET, a new EHLO, the end of DATA). */
const cleared = (s: Session, stage: string): Session => smtpCleared(s, stage, { authenticated: s.authenticated, ...(s.user ? { user: s.user } : {}) });

async function authenticate(ctx: HandlerContext, s: Session, p: Policy, user: string, pass: string): Promise<WireAnswer> {
  const next = { ...s };
  delete next.auth;
  if (!p.auth || user !== p.auth.username || pass !== p.auth.password) return cmd(next, authFailed('authentication failure'));
  const refusal = ctx.legal('Session', 'authenticated', 'AUTH', s.authenticated, 'true');
  if (refusal) return cmd(next, `${refusal.status} ${String(refusal.code)} ${refusal.message}`);
  return cmd({ ...next, authenticated: 'true', user }, AUTH_OK);
}

const b64 = (s: string): string | undefined => { try { return atob(s.trim()); } catch { return undefined; } };

async function command(ctx: HandlerContext, s: Session, line: string): Promise<WireAnswer> {
  const p = policyOf(ctx);
  const { verb, arg } = smtpCommand(line);
  switch (verb) { default: return unknownCommand(s);
    case 'EHLO': case 'HELO': {
      if (!arg.trim()) return cmd(s, `501 5.5.4 Syntax: ${verb} hostname`);
      order(ctx, s, verb, verb.toLowerCase());
      const next = cleared(s, verb.toLowerCase());
      return verb === 'EHLO' ? { replies: ehlo(p), session: next, mode: 'command' } : cmd(next, `250 ${p.hostname}`);
    }
    // source: spec:4.1.1.2 "This command clears the reverse-path buffer, the forward-path buffer, and the mail data buffer"
    case 'MAIL': {
      const refused = order(ctx, s, 'MAIL', 'mail');
      if (refused) return cmd(s, refused);
      const mail = smtpMailFrom(arg);
      if ('refused' in mail) return cmd(s, 'parameter' in mail ? unsupported(mail.parameter) : mail.refused === 'syntax' ? MAIL_SYNTAX : mail.refused === 'sender' ? BAD_SENDER : BAD_SIZE);
      const { from, size, smtputf8 } = mail;
      if (p.auth && s.authenticated !== 'true') return cmd(s, AUTH_REQUIRED);
      if (size !== undefined && size > p.maxSize) return cmd(s, TOO_BIG);
      if (p.senderDomains && from !== '' && !p.senderDomains.includes(domainOf(from))) return cmd(s, s.user ? notOwned(from, s.user) : senderDenied(from));
      return cmd({ ...s, stage: 'mail', from, rcpt: [], ...(smtputf8 ? { smtputf8 } : {}), ...(size !== undefined ? { declaredSize: size } : {}) }, OK_MAIL);
    }
    // source: spec:4.1.1.3 "This command is used to identify an individual recipient of the mail data; multiple recipients are specified by multiple uses of this command."
    case 'RCPT': {
      const refused = order(ctx, s, 'RCPT', 'rcpt');
      if (refused) return cmd(s, refused);
      const rcpt = smtpRcptTo(arg);
      // source: spec:4.1.1.11 "command, it will return code 555."
      if ('refused' in rcpt) return cmd(s, 'parameter' in rcpt ? unsupported(rcpt.parameter) : rcpt.refused === 'syntax' ? RCPT_SYNTAX : BAD_RECIPIENT);
      const { to } = rcpt;
      if (/[^\x00-\x7f]/.test(to) && !s.smtputf8) return cmd(s, BAD_RECIPIENT);
      // source: https://www.rfc-editor.org/rfc/rfc5321 "550 No such user here"
      if (p.localRecipients && p.localRecipients.some((a) => domainOf(a) === domainOf(to)) && !p.localRecipients.some((a) => a.toLowerCase() === to.toLowerCase())) return cmd(s, '550 5.1.1 No such user here');
      if (p.relayDomains && s.authenticated !== 'true' && !p.relayDomains.includes(domainOf(to))) return cmd(s, relayDenied(to));
      return cmd({ ...s, stage: 'rcpt', rcpt: [...s.rcpt, to] }, OK_RCPT);
    }
    // source: spec:4.1.1.4 "The receiver normally sends a 354 response to DATA"
    case 'DATA': {
      if (arg.trim()) return cmd(s, '501 5.5.4 Syntax: DATA');
      const refused = order(ctx, s, 'DATA', 'data');
      if (refused) return cmd(s, refused);
      return { replies: [GO_AHEAD], session: { ...s, stage: 'data' }, mode: 'data' };
    }
    // source: spec:4.1.1.5 "This command specifies that the current mail transaction will be aborted."
    case 'RSET': {
      if (arg.trim()) return cmd(s, '501 5.5.4 Syntax: RSET');
      const back = s.greeted ?? 'fresh';
      if (s.stage === 'mail' || s.stage === 'rcpt') order(ctx, s, 'RSET', back);
      return cmd(cleared(s, s.stage === 'mail' || s.stage === 'rcpt' ? back : s.stage), OK);
    }
    // source: spec:4.1.1.9 "This command does not affect any parameters or previously entered commands."
    case 'NOOP': return cmd(s, OK);
    // source: spec:4.1.1.10 "The QUIT command may be issued at any time."
    case 'QUIT': order(ctx, s, 'QUIT', 'closed'); return { replies: [BYE], session: { ...s, stage: 'closed' }, mode: 'command', close: true };
    case 'VRFY': return cmd(s, NO_VRFY);
    case 'STARTTLS': return cmd(s, NO_TLS);
    case 'AUTH': {
      if (!p.auth) return cmd(s, AUTH_OFF);
      const refused = order(ctx, s, 'AUTH');
      if (refused) return cmd(s, refused);
      const already = ctx.legal('Session', 'authenticated', 'AUTH', s.authenticated, 'true');
      if (already) return cmd(s, `${already.status} ${String(already.code)} ${already.message}`);
      const [mech = '', initial] = arg.trim().split(/\s+/);
      if (!mech) return cmd(s, AUTH_SYNTAX);
      return mech.toUpperCase() === 'PLAIN' ? (initial === undefined ? { replies: ['334 '], session: { ...s, auth: { mechanism: 'PLAIN' } }, mode: 'auth' } : plain(ctx, s, p, initial)) : otherAuth(s, mech, initial); }
  }
}

/** AUTH PLAIN's response: `authzid NUL authcid NUL passwd`, base64 (RFC 4616). */
// source: https://www.rfc-editor.org/rfc/rfc4616 "message   = [authzid] UTF8NUL authcid UTF8NUL passwd"
function plain(ctx: HandlerContext, s: Session, p: Policy, response: string): Promise<WireAnswer> {
  const decoded = b64(response);
  const parts = decoded?.split('\0');
  if (!parts || parts.length !== 3) { const next = { ...s }; delete next.auth; return Promise.resolve(cmd(next, authFailed('Invalid base64 data in continued response'))); }
  return authenticate(ctx, s, p, parts[1]!, parts[2]!);
}

/** A response to an AUTH challenge: PLAIN's credentials, LOGIN's user then password; `*` cancels (RFC 4954). */
async function authResponse(ctx: HandlerContext, s: Session, response: string): Promise<WireAnswer> {
  const p = policyOf(ctx);
  const mech = s.auth;
  if (!mech) return cmd(s, UNRECOGNIZED);
  // source: https://www.rfc-editor.org/rfc/rfc4954 "If the client wishes to cancel the authentication exchange, it issues a line with a single"
  if (response.trim() === '*') { const next = { ...s }; delete next.auth; return cmd(next, AUTH_ABORTED); }
  if (mech.mechanism === 'PLAIN') return plain(ctx, s, p, response);
  const decoded = b64(response);
  if (decoded === undefined) { const next = { ...s }; delete next.auth; return cmd(next, authFailed('Invalid base64 data in continued response')); }
  if (mech.user === undefined) return { replies: ['334 UGFzc3dvcmQ6'], session: { ...s, auth: { mechanism: 'LOGIN', user: decoded } }, mode: 'auth' };
  return authenticate(ctx, s, p, mech.user, decoded);
}

/** The end of a message's data: its size held against the limit, the message delivered into the World. */
async function endOfData(ctx: HandlerContext, s: Session, data: string): Promise<WireAnswer> {
  const p = policyOf(ctx);
  const back = s.greeted ?? 'ehlo';
  order(ctx, s, 'DATA', back);
  const next = cleared(s, back);
  const size = data.length;
  if (size > p.maxSize) return cmd(next, TOO_BIG);
  const id = await deliver(ctx, { from: s.from ?? '', to: s.rcpt, data, smtputf8: s.smtputf8 === true, ...(s.user ? { user: s.user } : {}) });
  return cmd(next, queued(id));
}

export async function around(ctx: HandlerContext, next: (request?: Request) => Promise<Response>): Promise<Response> {
  return smtpFront(ctx, next, BRIDGE, {
    open: () => ({ replies: [`220 ${policyOf(ctx).hostname} ESMTP`], session: BRIDGE.fresh(), mode: 'command' }),
    command: (s, line) => command(ctx, s, line),
    data: (s, data) => endOfData(ctx, s, data),
    response: (s, response) => authResponse(ctx, s, response),
  });
}
