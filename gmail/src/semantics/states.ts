// Gmail's receiving server's state machine (docs/contributing/architecture.md, "What an author writes": states): a
// session's stage, each move cited from RFC 5321. The front (./around.ts) asks it for every command, so the declaration
// is the rule. A receiving server asks no authentication, so a session has no AUTH stage.
import type { StateField, Transition } from '@volter/world-core';

const RFC5321 = (section: string, quote: string): string => `spec:${section} "${quote}"`;
// Where the documentation stops: Gmail's words for a command out of order, recalled from its server's replies
const badSequence = (message: string) => ({ status: 503, code: '5.5.1', message });

const ORDER = 'Once started, a mail transaction consists of a transaction beginning command, one or more RCPT commands, and a DATA command, in that order.';

// fresh (nothing yet), helo or ehlo (greeted), mail (a sender), rcpt (recipients), data (the message's lines), closed
const stage: Transition[] = [
  { operation: 'EHLO', from: '*', to: 'ehlo', source: RFC5321('4.1.4', 'If it is issued after the session begins and the EHLO command is acceptable to the SMTP server, the SMTP server MUST clear all buffers and reset the state exactly as if a RSET command had been issued.') },
  { operation: 'HELO', from: '*', to: 'helo', source: RFC5321('4.1.1.1', 'These commands are used to identify the SMTP client to the SMTP server.') },
  {
    operation: 'MAIL', from: ['helo', 'ehlo'], to: 'mail',
    refusals: { fresh: badSequence('EHLO/HELO first. - gsmtp'), mail: badSequence('Nested MAIL command. - gsmtp'), rcpt: badSequence('Nested MAIL command. - gsmtp') },
    source: RFC5321('4.1.4', 'MAIL (or SEND, SOML, or SAML) MUST NOT be sent if a mail transaction is already open'),
  },
  {
    operation: 'RCPT', from: ['mail', 'rcpt'], to: 'rcpt',
    refusals: { fresh: badSequence('MAIL first. - gsmtp'), helo: badSequence('MAIL first. - gsmtp'), ehlo: badSequence('MAIL first. - gsmtp') },
    source: RFC5321('4.1.4', ORDER),
  },
  {
    operation: 'DATA', from: ['rcpt'], to: 'data',
    refusals: { fresh: badSequence('MAIL first. - gsmtp'), helo: badSequence('MAIL first. - gsmtp'), ehlo: badSequence('MAIL first. - gsmtp'), mail: badSequence('RCPT first. - gsmtp') },
    source: RFC5321('4.1.4', ORDER),
  },
  // the end-of-data dot closes the transaction, back to the greeting the session had
  { operation: 'DATA', from: ['data'], to: 'ehlo', source: RFC5321('4.1.4', 'or if the previous one successfully concluded with a successful DATA command') },
  { operation: 'DATA', from: ['data'], to: 'helo', source: RFC5321('4.1.4', 'or if the previous one successfully concluded with a successful DATA command') },
  { operation: 'RSET', from: ['mail', 'rcpt'], to: 'ehlo', source: RFC5321('4.1.1.5', 'This command specifies that the current mail transaction will be aborted.') },
  { operation: 'RSET', from: ['mail', 'rcpt'], to: 'helo', source: RFC5321('4.1.1.5', 'This command specifies that the current mail transaction will be aborted.') },
  { operation: 'QUIT', from: '*', to: 'closed', source: RFC5321('4.1.1.10', 'The QUIT command may be issued at any time.') },
];

export const states: Record<string, { state: Record<string, StateField> }> = {
  Session: { state: { stage: { initial: 'fresh', transitions: stage } } },
};
