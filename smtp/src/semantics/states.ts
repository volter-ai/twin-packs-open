// SMTP's state machines (docs/contributing/architecture.md, "What an author writes": states): a session's stage and
// whether it has authenticated, each move cited from RFC 5321 and RFC 4954. The front (./around.ts) asks them for every
// command, so the declaration is the rule.
import type { StateField, Transition } from '@volter/world-core';

const RFC5321 = (section: string, quote: string): string => `spec:${section} "${quote}"`;
const RFC4954 = (quote: string): string => `https://www.rfc-editor.org/rfc/rfc4954 "${quote}"`;
const badSequence = (message: string) => ({ status: 503, code: '5.5.1', message });

const ORDER = 'Once started, a mail transaction consists of a transaction beginning command, one or more RCPT commands, and a DATA command, in that order.';

// fresh (nothing yet), helo or ehlo (greeted), mail (a sender), rcpt (recipients), data (the message's
// lines), closed. A mail transaction runs mail → rcpt → data and returns to the greeting it began from.
const stage: Transition[] = [
  { operation: 'EHLO', from: '*', to: 'ehlo', source: RFC5321('4.1.4', 'If it is issued after the session begins and the EHLO command is acceptable to the SMTP server, the SMTP server MUST clear all buffers and reset the state exactly as if a RSET command had been issued.') },
  { operation: 'HELO', from: '*', to: 'helo', source: RFC5321('4.1.1.1', 'These commands are used to identify the SMTP client to the SMTP server.') },
  {
    operation: 'MAIL', from: ['helo', 'ehlo'], to: 'mail',
    refusals: { fresh: badSequence('Error: send HELO/EHLO first'), mail: badSequence('Error: nested MAIL command'), rcpt: badSequence('Error: nested MAIL command') },
    source: RFC5321('4.1.4', 'MAIL (or SEND, SOML, or SAML) MUST NOT be sent if a mail transaction is already open'),
  },
  {
    operation: 'RCPT', from: ['mail', 'rcpt'], to: 'rcpt',
    refusals: { fresh: badSequence('Error: need MAIL command'), helo: badSequence('Error: need MAIL command'), ehlo: badSequence('Error: need MAIL command') },
    source: RFC5321('4.1.4', ORDER),
  },
  {
    operation: 'DATA', from: ['rcpt'], to: 'data',
    refusals: { fresh: badSequence('Error: need MAIL command'), helo: badSequence('Error: need MAIL command'), ehlo: badSequence('Error: need MAIL command'), mail: badSequence('Error: need RCPT command') },
    source: RFC5321('4.1.4', ORDER),
  },
  // the end-of-data dot closes the transaction, back to the greeting the session had
  { operation: 'DATA', from: ['data'], to: 'ehlo', source: RFC5321('4.1.4', 'or if the previous one successfully concluded with a successful DATA command') },
  { operation: 'DATA', from: ['data'], to: 'helo', source: RFC5321('4.1.4', 'or if the previous one successfully concluded with a successful DATA command') },
  // RSET moves only an open transaction; anywhere else it is a NOOP
  { operation: 'RSET', from: ['mail', 'rcpt'], to: 'ehlo', source: RFC5321('4.1.1.5', 'This command specifies that the current mail transaction will be aborted.') },
  { operation: 'RSET', from: ['mail', 'rcpt'], to: 'helo', source: RFC5321('4.1.1.5', 'This command specifies that the current mail transaction will be aborted.') },
  { operation: 'QUIT', from: '*', to: 'closed', source: RFC5321('4.1.1.10', 'The QUIT command may be issued at any time.') },
  {
    operation: 'AUTH', from: ['ehlo'],
    refusals: { fresh: badSequence('Error: send EHLO first'), helo: badSequence('Error: send EHLO first'), mail: badSequence('Error: MAIL transaction in progress'), rcpt: badSequence('Error: MAIL transaction in progress') },
    source: RFC4954('An AUTH command issued during a mail transaction MUST be rejected with a 503 reply.'),
  },
];

// a session authenticates once
const authenticated: Transition[] = [
  { operation: 'AUTH', from: ['true'], refusal: badSequence('Error: already authenticated'), source: RFC4954('After a successful AUTH command completes, a server MUST reject any further AUTH commands with a 503 reply.') },
  { operation: 'AUTH', from: ['false'], to: 'true', source: RFC4954('After a successful AUTH command completes, a server MUST reject any further AUTH commands with a 503 reply.') },
];

export const states: Record<string, { state: Record<string, StateField> }> = {
  Session: { state: { stage: { initial: 'fresh', transitions: stage }, authenticated: { initial: 'false', transitions: authenticated } } },
};
