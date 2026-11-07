// GMAIL'S RECEIVING SERVER'S FRONT: each command a connection sends, run as RFC 5321 orders it and Gmail's MX answers
// it. The byte-stream door (../stream.ts) frames a connection's bytes and posts each command (or a message's whole data)
// here with the session it carries; the answer is the reply lines, the moved session, and what the stream reads next.
// Every other request is the webmail's (the screens).
//
// The server takes mail from any sender, as an MX does, and refuses a recipient it does not hold: an address at another
// domain (it relays for no one) or a gmail.com address that is no Google account (550 5.1.1). It asks no authentication
// and has no certificate here, so it advertises neither AUTH nor STARTTLS (ADR 0032 §4).
import { smtpServer, type HandlerContext } from '@volter/world-core';
import {
  accountOf, BRIDGE, BYE, deliver, GO_AHEAD, GREETING, HOST, MAIL_DOMAIN, MAX_SIZE, NO_ACCOUNT, NO_TLS, NOT_OURS, OK, OK_MAIL, OK_RCPT,
  type Session, SYNTAX, TOO_BIG, UNRECOGNIZED, unsupported, type WireAnswer,
} from './shared.ts';

const { smtpCleared, smtpCommand, smtpDomain: domainOf, smtpEhlo, smtpFront, smtpMailFrom, smtpOrder, smtpRcptTo } = smtpServer;

const cmd = (session: Session, ...replies: string[]): WireAnswer => ({ replies, session, mode: 'command' });

/** The machine's word on a command from where the session stands: a refusal's reply, or undefined to go on. */
const order = (ctx: HandlerContext, s: Session, op: string, to?: string): string | undefined => smtpOrder(ctx, 'Session', s.stage, op, to);

/** A transaction's state cleared, the greeting kept (RSET, a new EHLO, the end of DATA). */
const cleared = (s: Session, stage: string): Session => smtpCleared(s, stage, {});

function command(ctx: HandlerContext, s: Session, line: string): WireAnswer {
  const { verb, arg } = smtpCommand(line);
  switch (verb) { default: return cmd(s, UNRECOGNIZED);
    case 'EHLO': case 'HELO': {
      if (!arg.trim()) return cmd(s, `501 5.5.4 Empty ${verb} argument not allowed, closing connection. - gsmtp`);
      order(ctx, s, verb, verb.toLowerCase());
      const next = cleared(s, verb.toLowerCase());
      if (verb === 'HELO') return cmd(next, `250 ${HOST} at your service`);
      return { replies: smtpEhlo([`${HOST} at your service`, `SIZE ${MAX_SIZE}`, '8BITMIME', 'ENHANCEDSTATUSCODES', 'PIPELINING', 'SMTPUTF8']), session: next, mode: 'command' };
    }
    // source: spec:4.1.1.2 "This command clears the reverse-path buffer, the forward-path buffer, and the mail data buffer"
    case 'MAIL': {
      const refused = order(ctx, s, 'MAIL', 'mail');
      if (refused) return cmd(s, refused);
      const mail = smtpMailFrom(arg);
      if ('refused' in mail) return cmd(s, 'parameter' in mail ? unsupported(mail.parameter) : SYNTAX);
      if (mail.size !== undefined && mail.size > MAX_SIZE) return cmd(s, TOO_BIG);
      return cmd({ ...s, stage: 'mail', from: mail.from.toLowerCase(), rcpt: [], ...(mail.smtputf8 ? { smtputf8: true } : {}) }, OK_MAIL);
    }
    // source: spec:4.1.1.3 "This command is used to identify an individual recipient of the mail data; multiple recipients are specified by multiple uses of this command."
    case 'RCPT': {
      const refused = order(ctx, s, 'RCPT', 'rcpt');
      if (refused) return cmd(s, refused);
      const rcpt = smtpRcptTo(arg);
      if ('refused' in rcpt) return cmd(s, 'parameter' in rcpt ? unsupported(rcpt.parameter) : SYNTAX);
      const to = rcpt.to.toLowerCase();
      if (domainOf(to) !== MAIL_DOMAIN) return cmd(s, NOT_OURS);
      if (!accountOf(ctx, to)) return cmd(s, NO_ACCOUNT);
      return cmd({ ...s, stage: 'rcpt', rcpt: [...s.rcpt, to] }, OK_RCPT);
    }
    // source: spec:4.1.1.4 "The receiver normally sends a 354 response to DATA"
    case 'DATA': {
      const refused = order(ctx, s, 'DATA', 'data');
      if (refused) return cmd(s, refused);
      return { replies: [GO_AHEAD], session: { ...s, stage: 'data' }, mode: 'data' };
    }
    // source: spec:4.1.1.5 "This command specifies that the current mail transaction will be aborted."
    case 'RSET': {
      const back = s.greeted ?? 'fresh';
      if (s.stage === 'mail' || s.stage === 'rcpt') order(ctx, s, 'RSET', back);
      return cmd(cleared(s, s.stage === 'mail' || s.stage === 'rcpt' ? back : s.stage), OK);
    }
    // source: spec:4.1.1.9 "This command does not affect any parameters or previously entered commands."
    case 'NOOP': return cmd(s, OK);
    // source: spec:4.1.1.10 "The QUIT command may be issued at any time."
    case 'QUIT': order(ctx, s, 'QUIT', 'closed'); return { replies: [BYE], session: { ...s, stage: 'closed' }, mode: 'command', close: true };
    case 'STARTTLS': return cmd(s, NO_TLS);
  }
}

/** The end of a message's data: its size held against the limit, the message kept in each recipient's mailbox. */
async function endOfData(ctx: HandlerContext, s: Session, data: string): Promise<WireAnswer> {
  const back = s.greeted ?? 'ehlo';
  order(ctx, s, 'DATA', back);
  const next = cleared(s, back);
  if (data.length > MAX_SIZE) return cmd(next, TOO_BIG);
  await deliver(ctx, { from: s.from ?? '', to: s.rcpt, data, smtputf8: s.smtputf8 === true });
  return cmd(next, OK);
}

export async function around(ctx: HandlerContext, next: (request?: Request) => Promise<Response>): Promise<Response> {
  return smtpFront(ctx, next, BRIDGE, {
    open: () => ({ replies: [GREETING], session: BRIDGE.fresh(), mode: 'command' }),
    command: (s, line) => command(ctx, s, line),
    data: (s, data) => endOfData(ctx, s, data),
  });
}
