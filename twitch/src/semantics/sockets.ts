// Twitch's chat over IRC on WebSocket (the manifest's socket `chat`, the kernel's sockets.ts), as a stream rig's chat
// reader holds it open: it asks for the tags capability, logs in anonymously (PASS SCHMOOPIIE, a justinfan nick), joins
// the channel, reads each chat message as a PRIVMSG and leaves with PART. A WebSocket frame carries one or more IRC
// messages, each ended by CRLF, in both directions.
//
// Where the twin stops: a login with a user access token (`PASS oauth:<token>`), sending chat over IRC, and the
// twitch.tv/commands and twitch.tv/membership capabilities are Twitch's, not modelled (no demanded client uses them):
// a token login is answered as a login Twitch cannot authenticate, and those capabilities with the standard NAK the page
// shows for one the server does not support. Twitch's own PING every few minutes is not sent: the World has no timer a
// session runs on.
import type { EventWrite, HandlerContext, SocketEngine, SocketSession } from '@volter/world-core';
import { userByLogin, type Row } from './shared.ts';

type Session = { caps: string[]; pass?: string; nick?: string; welcomed: boolean; joined: string[] };
const state = (s: SocketSession): Session => s.state as Session;

const SERVER = 'tmi.twitch.tv';
// source: https://dev.twitch.tv/docs/chat/irc/ "Adds additional metadata to the command and membership messages."
const MODELLED_CAPS = ['twitch.tv/tags'];

/** One IRC message: its tags, its source, its command and its parameters (the last one after ` :`). */
function parse(line: string): { command: string; params: string[] } {
  let rest = line;
  if (rest.startsWith('@')) rest = rest.slice(rest.indexOf(' ') + 1);
  if (rest.startsWith(':')) rest = rest.slice(rest.indexOf(' ') + 1);
  const at = rest.indexOf(' :');
  const head = (at < 0 ? rest : rest.slice(0, at)).split(' ').filter(Boolean);
  const params = head.slice(1);
  if (at >= 0) params.push(rest.slice(at + 2));
  return { command: (head[0] ?? '').toUpperCase(), params };
}

/** A frame of IRC messages, each ended by CRLF. */
// source: https://dev.twitch.tv/docs/chat/irc/ "Each message is delimited by CRLF"
const frame = (lines: string[]): string => lines.map((l) => `${l}\r\n`).join('');

/** A tag's value escaped as IRCv3 escapes it (the display-name tag is "escaped as described in the IRCv3 spec"). */
// source: https://dev.twitch.tv/docs/chat/irc/ "escaped as described in the IRCv3 spec"
const escapeTag = (value: string): string => value.replace(/\\/g, '\\\\').replace(/;/g, '\\:').replace(/ /g, '\\s').replace(/\r/g, '\\r').replace(/\n/g, '\\n');

/** A chat message as the server sends it to a session that joined its channel: tagged when the session asked for tags. */
// source: https://dev.twitch.tv/docs/chat/irc/ "Sent when a user sends a chat message to a chatroom your bot has joined."
function privmsg(m: Row, tagged: boolean): string {
  const login = String(m.sender_login);
  // An IRC message is one line: a CR or LF in a chat message can never end it and begin a forged one, so each is a space.
  // source: https://www.rfc-editor.org/rfc/rfc1459 "IRC messages are always lines of characters terminated with a CR-LF"
  // NUL and the other control characters a line may not carry are left out with them (PR review 2826).
  // eslint-disable-next-line no-control-regex
  const text = String(m.message).replace(/[\r\n]/gu, ' ').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '');
  const line = `:${login}!${login}@${login}.${SERVER} PRIVMSG #${String(m.broadcaster_login)} :${text}`;
  if (!tagged) return line;
  const tags: Record<string, string> = {
    'badge-info': '', badges: String(m.badges ?? ''), color: String(m.color ?? ''), 'display-name': escapeTag(String(m.sender_name ?? '')),
    emotes: '', 'first-msg': m.first_msg === true ? '1' : '0', flags: '', id: String(m.id), mod: '0', 'returning-chatter': '0',
    'room-id': String(m.broadcaster_id), subscriber: '0', 'tmi-sent-ts': String(m.sent_at_ms), turbo: '0', 'user-id': String(m.sender_id), 'user-type': '',
  };
  // source: https://dev.twitch.tv/docs/chat/irc/ "The message does not include this tag if this message is not a reply."
  if (typeof m.reply_parent_message_id === 'string') {
    Object.assign(tags, {
      'reply-parent-display-name': escapeTag(String(m.reply_parent_display_name ?? '')), 'reply-parent-msg-body': escapeTag(String(m.reply_parent_msg_body ?? '')),
      'reply-parent-msg-id': m.reply_parent_message_id, 'reply-parent-user-id': String(m.reply_parent_user_id ?? ''), 'reply-parent-user-login': String(m.reply_parent_user_login ?? ''),
      'reply-thread-parent-msg-id': m.reply_parent_message_id, 'reply-thread-parent-user-login': String(m.reply_parent_user_login ?? ''),
    });
  }
  return `@${Object.keys(tags).sort().map((k) => `${k}=${tags[k]}`).join(';')} ${line}`;
}

function open(s: SocketSession): void {
  Object.assign(s.state, { caps: [], welcomed: false, joined: [] } satisfies Session);
}

function message(s: SocketSession, data: string, ctx: HandlerContext): void {
  const st = state(s);
  for (const line of data.split(/\r?\n/).filter((l) => l.trim() !== '')) {
    const { command, params } = parse(line);
    if (command === 'CAP' && (params[0] ?? '').toUpperCase() === 'REQ') {
      const asked = (params[1] ?? '').split(' ').filter(Boolean);
      // source: https://dev.twitch.tv/docs/chat/irc/ "If your capabilities request succeeds, Twitch replies with the standard ACK subcommand message"
      // source: https://dev.twitch.tv/docs/chat/irc/ "the server replies with the standard NAK subcommand message that identifies the capabilities that were denied"
      if (asked.every((c) => MODELLED_CAPS.includes(c))) { st.caps.push(...asked); s.send(frame([`:${SERVER} CAP * ACK :${asked.join(' ')}`])); }
      else s.send(frame([`:${SERVER} CAP * NAK :${asked.join(' ')}`]));
    } else if (command === 'PASS') {
      st.pass = params[0] ?? '';
    } else if (command === 'NICK') {
      const nick = (params[0] ?? '').toLowerCase();
      // source: https://dev.twitch.tv/docs/chat/irc/ "send the PASS and NICK messages in the correct order, the authentication fails"
      if (st.pass === undefined) { s.send(frame([`:${SERVER} NOTICE * :Improperly formatted auth`])); s.close(1000); return; }
      // the anonymous login a logged-out chat reader makes: any password, a justinfan nick (recorded: Twitch welcomes it)
      // source: recording:2026-10-08-irc-anonymous.json ":tmi.twitch.tv 001 justinfan48213 :Welcome, GLHF!"
      if (!/^justinfan\d+$/.test(nick)) {
        // source: https://dev.twitch.tv/docs/chat/irc/ "If the server fails to authenticate your bot, it replies with the following message and closes the connection."
        s.send(frame([`:${SERVER} NOTICE * :Login authentication failed`]));
        s.close(1000);
        return;
      }
      st.nick = nick;
      st.welcomed = true;
      // source: https://dev.twitch.tv/docs/chat/irc/ "You are in a maze of twisty passages, all alike."
      s.send(frame([
        `:${SERVER} 001 ${nick} :Welcome, GLHF!`, `:${SERVER} 002 ${nick} :Your host is ${SERVER}`, `:${SERVER} 003 ${nick} :This server is rather new`,
        `:${SERVER} 004 ${nick} :-`, `:${SERVER} 375 ${nick} :-`, `:${SERVER} 372 ${nick} :You are in a maze of twisty passages, all alike.`, `:${SERVER} 376 ${nick} :>`,
      ]));
    } else if (command === 'JOIN' && st.welcomed) {
      for (const name of (params[0] ?? '').split(',').map((c) => c.trim().replace(/^#/, '').toLowerCase()).filter(Boolean)) {
        // source: https://dev.twitch.tv/docs/chat/irc/ "If you try to join a nonexistent channel, Twitch quietly drops your JOIN message."
        if (!userByLogin(ctx, name) || st.joined.includes(name)) continue;
        st.joined.push(name);
        const nick = st.nick!;
        // source: https://dev.twitch.tv/docs/chat/irc/ "If the bot successfully joins the channel, the server replies with the JOIN , 353 , and 366 messages."
        s.send(frame([`:${nick}!${nick}@${nick}.${SERVER} JOIN #${name}`, `:${nick}.${SERVER} 353 ${nick} = #${name} :${nick}`, `:${nick}.${SERVER} 366 ${nick} #${name} :End of /NAMES list`]));
      }
    } else if (command === 'PART' && st.welcomed) {
      for (const name of (params[0] ?? '').split(',').map((c) => c.trim().replace(/^#/, '').toLowerCase()).filter((c) => st.joined.includes(c))) {
        st.joined = st.joined.filter((c) => c !== name);
        // source: recording:2026-10-08-irc-anonymous.json "PART #aaronvolter"
        s.send(frame([`:${st.nick}!${st.nick}@${st.nick}.${SERVER} PART #${name}`]));
      }
    }
    // Where the twin stops: an anonymous login's PRIVMSG, a client's PING or PONG and a command Twitch does not name are
    // answered with nothing (the recording shows Twitch answers a client's PING; no demanded client sends one).
  }
}

/** A chat message sent: every session that joined its channel is sent it. */
function write(s: SocketSession, w: EventWrite, ctx: HandlerContext): void {
  if (w.storedType !== 'chat_message' || w.operation !== 'sendChatMessage') return;
  const st = state(s);
  const sent = ctx.row('chat_message', String(w.body.id ?? ''));
  if (!sent || !st.joined.includes(String(sent.broadcaster_login))) return;
  s.send(frame([privmsg(sent, st.caps.includes('twitch.tv/tags'))]));
}

export const chat: SocketEngine<HandlerContext> = { open, message, write };
