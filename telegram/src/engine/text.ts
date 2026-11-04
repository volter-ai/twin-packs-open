// A message's text as Telegram makes it from what a client sends: the parse modes (HTML, MarkdownV2 and the legacy
// Markdown) read into plain text and entities, the entities the server finds itself in the text (mentions, commands,
// hashtags, links), and the trim. Pure computation over strings; offsets and lengths are UTF-16 code units, as the Bot
// API counts them (https://core.telegram.org/bots/api#messageentity, "Offset in UTF-16 code units to the start of the
// entity").
//
// The parses are the ones TDLib runs for the Bot API (td/telegram/MessageEntity.cpp at tdlib/td 42e6a52: parse_html,
// parse_markdown_v2 and parse_markdown), read as code and written again here: their tags and marks, their character
// references and escapes, their errors and their words. A link to a user (tg://user?id=) is answered as a `user_id` the
// caller resolves to the user, or drops.

export type Entity = { type: string; offset: number; length: number; url?: string; language?: string; custom_emoji_id?: string; unix_time?: number; date_time_format?: string; user_id?: number };
export type Formatted = { text: string; entities: Entity[] };

/** UTF-8 byte length of a string: TDLib's errors name byte offsets. */
const bytes = (s: string): number => new TextEncoder().encode(s).length;

const TAGS = new Set(['a', 'b', 'strong', 'i', 'em', 's', 'strike', 'del', 'u', 'ins', 'tg-spoiler', 'tg-emoji', 'tg-time', 'span', 'pre', 'code', 'blockquote']);
const SPACE = /[ \t\n\r\f\v]/;

/** The named references TDLib decodes (lt, gt, amp, quot) and numeric ones; anything else stays as it is written. */
function decodeEntity(text: string, i: number): { code: number; end: number } | undefined {
  let end = i + 1;
  let code = 0;
  if (text[i + 1] === '#') {
    end++;
    if (text[i + 2] === 'x') {
      end++;
      while (end < text.length && /[0-9a-fA-F]/.test(text[end]!)) code = code * 16 + parseInt(text[end++]!, 16);
    } else {
      while (end < text.length && /[0-9]/.test(text[end]!)) code = code * 10 + Number(text[end++]);
    }
    if (code === 0 || code >= 0x10ffff || end - i >= 10) return undefined;
  } else {
    while (end < text.length && /[A-Za-z]/.test(text[end]!)) end++;
    const name = text.slice(i + 1, end);
    code = name === 'lt' ? 60 : name === 'gt' ? 62 : name === 'amp' ? 38 : name === 'quot' ? 34 : 0;
    if (!code) return undefined;
  }
  if (text[end] === ';') end++;
  return { code, end };
}

/** The HTML parse mode: the text and its entities, or the parser's refusal in TDLib's words. */
export function parseHtml(input: string): Formatted | { error: string } {
  let out = '';
  const entities: Entity[] = [];
  const open: Array<{ tag: string; argument: string; date: number; offset: number; start: number }> = [];
  let i = 0;
  while (i < input.length) {
    const c = input[i]!;
    if (c === '&') {
      const d = decodeEntity(input, i);
      if (d) { out += String.fromCodePoint(d.code); i = d.end; continue; }
    }
    if (c !== '<') { out += c; i++; continue; }
    const begin = bytes(input.slice(0, i));
    i++;
    if (input[i] !== '/') {
      let j = i;
      while (j < input.length && !SPACE.test(input[j]!) && input[j] !== '>') j++;
      if (j >= input.length) return { error: `Unclosed start tag at byte offset ${begin}` };
      const tag = input.slice(i, j).toLowerCase();
      if (!TAGS.has(tag)) return { error: `Unsupported start tag "${tag}" at byte offset ${begin}` };
      let argument = '';
      let date = 0;
      while (input[j] !== '>') {
        while (j < input.length && SPACE.test(input[j]!)) j++;
        if (input[j] === '>') break;
        const nameStart = j;
        while (j < input.length && !SPACE.test(input[j]!) && !'=>/"\''.includes(input[j]!)) j++;
        const name = input.slice(nameStart, j);
        if (!name) return { error: `Empty attribute name in the tag "${tag}" at byte offset ${begin}` };
        while (j < input.length && SPACE.test(input[j]!)) j++;
        if (input[j] !== '=') {
          if (j >= input.length) return { error: `Unclosed start tag "${tag}" at byte offset ${begin}` };
          if (tag === 'blockquote' && name === 'expandable') argument = '1';
          continue;
        }
        j++;
        while (j < input.length && SPACE.test(input[j]!)) j++;
        if (j >= input.length) return { error: `Unclosed start tag "${tag}" at byte offset ${begin}` };
        // a value is a quoted string (its references decoded), or a name token (letters, digits, periods and hyphens,
        // read without case)
        const quote = input[j] === '"' || input[j] === "'" ? input[j++]! : undefined;
        const valueStart = j;
        let value = '';
        while (j < input.length && (quote ? input[j] !== quote : /[A-Za-z0-9.-]/.test(input[j]!))) {
          const d = quote && input[j] === '&' ? decodeEntity(input, j) : undefined;
          value += d ? String.fromCodePoint(d.code) : input[j];
          j = d ? d.end : j + 1;
        }
        if (quote && input[j] === quote) j++;
        if (!quote) value = value.toLowerCase();
        if (!quote && j < input.length && !SPACE.test(input[j]!) && input[j] !== '>') return { error: `Unexpected end of name token at byte offset ${bytes(input.slice(0, valueStart))}` };
        if (j >= input.length) return { error: `Unclosed start tag at byte offset ${begin}` };
        if (tag === 'a' && name === 'href') argument = value;
        else if (tag === 'code' && name === 'class' && value.startsWith('language-')) argument = value.slice(9);
        else if (tag === 'span' && name === 'class' && value.startsWith('tg-')) argument = value.slice(3);
        else if (tag === 'blockquote' && name === 'expandable') argument = '1';
        else if (tag === 'tg-emoji' && name === 'emoji-id') argument = value;
        else if (tag === 'tg-time' && name === 'unix') date = /^-?\d+$/.test(value) ? Number(value) : 0;
        else if (tag === 'tg-time' && name === 'format') argument = value;
      }
      if (tag === 'span' && argument !== 'spoiler') return { error: `Tag "span" must have class "tg-spoiler" at byte offset ${begin}` };
      open.push({ tag, argument, date, offset: out.length, start: out.length });
      i = j + 1;
      continue;
    }
    // an end tag
    if (!open.length) return { error: `Unexpected end tag at byte offset ${begin}` };
    let j = i + 1;
    while (j < input.length && !SPACE.test(input[j]!) && input[j] !== '>') j++;
    const endTag = input.slice(i + 1, j).toLowerCase();
    while (j < input.length && SPACE.test(input[j]!)) j++;
    if (input[j] !== '>') return { error: `Unclosed end tag at byte offset ${begin}` };
    const top = open.at(-1)!;
    if (endTag && endTag !== top.tag) return { error: `Unmatched end tag at byte offset ${begin}, expected "</${top.tag}>", found "</${endTag}>"` };
    const length = out.length - top.offset;
    if (length > 0) {
      const at = { offset: top.offset, length };
      if (top.tag === 'i' || top.tag === 'em') entities.push({ type: 'italic', ...at });
      else if (top.tag === 'b' || top.tag === 'strong') entities.push({ type: 'bold', ...at });
      else if (top.tag === 's' || top.tag === 'strike' || top.tag === 'del') entities.push({ type: 'strikethrough', ...at });
      else if (top.tag === 'u' || top.tag === 'ins') entities.push({ type: 'underline', ...at });
      else if (top.tag === 'tg-spoiler' || top.tag === 'span') entities.push({ type: 'spoiler', ...at });
      else if (top.tag === 'tg-emoji') {
        if (!/^\d+$/.test(top.argument) || /^0+$/.test(top.argument)) return { error: 'Invalid custom emoji identifier specified' };
        entities.push({ type: 'custom_emoji', ...at, custom_emoji_id: top.argument });
      } else if (top.tag === 'tg-time') {
        if (!/^([rR]|[tTdDwW]*)$/.test(top.argument)) return { error: 'Invalid date format used' };
        if (top.date > 0) entities.push({ type: 'date_time', ...at, unix_time: top.date, ...(top.argument ? { date_time_format: top.argument } : {}) });
      } else if (top.tag === 'a') {
        const link = linkOf(top.argument || out.slice(top.start));
        if (link) entities.push(linkEntity(link, at.offset, at.length));
      } else if (top.tag === 'pre') {
        const last = entities.at(-1);
        if (last?.type === 'code' && last.offset === at.offset && last.length === at.length && last.language) entities[entities.length - 1] = { type: 'pre', ...at, language: last.language };
        else entities.push({ type: 'pre', ...at });
      } else if (top.tag === 'code') {
        const last = entities.at(-1);
        if (last?.type === 'pre' && last.offset === at.offset && last.length === at.length && top.argument) entities[entities.length - 1] = { type: 'pre', ...at, language: top.argument };
        else entities.push({ type: 'code', ...at, ...(top.argument ? { language: top.argument } : {}) });
      } else if (top.tag === 'blockquote') entities.push({ type: top.argument ? 'expandable_blockquote' : 'blockquote', ...at });
    }
    open.pop();
    i = j + 1;
  }
  if (open.length) return { error: `Can't find end tag corresponding to start tag "${open.at(-1)!.tag}"` };
  // a code entity's language is kept only on pre
  for (const e of entities) if (e.type === 'code') delete e.language;
  return { text: out, entities: sortEntities(entities) };
}

/** What a link's address makes of its text (TDLib's LinkManager: get_link_user_id, then get_checked_link): a mention of
 *  a user by id, a link (an address with no scheme is taken as http), or nothing for an address it does not take. */
function linkOf(url: string): { type: 'text_mention'; user_id: number } | { type: 'text_link'; url: string } | undefined {
  const user = /^tg:\/\/user\?id=(\d+)$/i.exec(url);
  if (user) return { type: 'text_mention', user_id: Number(user[1]) };
  return /^(https?|tg|ton):\/\//i.test(url) || /^[^\s:/]+\.[^\s:/]+/.test(url) ? { type: 'text_link', url: /^[a-z]+:\/\//i.test(url) ? url : `http://${url}` } : undefined;
}

/** A link's entity over a range of the text. */
const linkEntity = (link: NonNullable<ReturnType<typeof linkOf>>, offset: number, length: number): Entity =>
  link.type === 'text_mention' ? { type: link.type, offset, length, user_id: link.user_id } : { type: link.type, offset, length, url: link.url };

/** A custom emoji's id from its tg://emoji link, or undefined. */
const emojiOf = (url: string): string | undefined => {
  const m = /^tg:\/\/emoji\?id=(\d+)$/i.exec(url);
  return m && !/^0+$/.test(m[1]!) ? m[1] : undefined;
};

/** A date's moment and format from its tg://time link (the same formats the HTML mode's tg-time takes), or undefined. */
const timeOf = (url: string): { unix_time: number; date_time_format?: string } | undefined => {
  const m = /^tg:\/\/time\?(.*)$/i.exec(url);
  if (!m) return undefined;
  const q = new URLSearchParams(m[1]);
  const unix = q.get('unix') ?? '';
  const format = q.get('format') ?? '';
  if (!/^\d+$/.test(unix) || Number(unix) <= 0 || !/^([rR]|[tTdDwW]*)$/.test(format)) return undefined;
  return { unix_time: Number(unix), ...(format ? { date_time_format: format } : {}) };
};

/** A link's address in the Markdown modes: up to its closing parenthesis, a backslash escaping the character after it. */
function addressAt(input: string, from: number): { url: string; end: number } | { error: string } {
  let url = '';
  let i = from;
  while (i < input.length && input[i] !== ')') {
    const next = input.charCodeAt(i + 1);
    if (input[i] === '\\' && next > 0 && next <= 126) { url += input[i + 1]; i += 2; continue; }
    url += input[i++];
  }
  if (input[i] !== ')') return { error: `Can't find end of a URL at byte offset ${bytes(input.slice(0, from))}` };
  return { url, end: i };
}

type Mark = 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'code' | 'pre' | 'pre_code' | 'text_link' | 'custom_emoji' | 'blockquote';
/** A mark's name in TDLib's errors. */
const MARK_NAME: Record<Mark, string> = {
  bold: 'Bold', italic: 'Italic', underline: 'Underline', strikethrough: 'Strikethrough', spoiler: 'Spoiler', code: 'Code',
  pre: 'Pre', pre_code: 'PreCode', text_link: 'TextUrl', custom_emoji: 'CustomEmoji', blockquote: 'BlockQuote',
};
const RESERVED = '_*[]()~`>#+-=|{}.!\n';

/** Whether a character closes the innermost mark open (TDLib's is_end_of_an_entity, a quotation aside). */
const closesMark = (mark: Mark, c: string, twice: boolean, third: string | undefined): boolean =>
  mark === 'bold' ? c === '*' : mark === 'italic' ? c === '_' && !twice : mark === 'code' ? c === '`' : mark === 'pre' || mark === 'pre_code' ? c === '`' && twice && third === '`'
    : mark === 'text_link' || mark === 'custom_emoji' ? c === ']' : mark === 'underline' ? c === '_' && twice : mark === 'strikethrough' ? c === '~' : mark === 'spoiler' ? c === '|' && twice : false;

/** The MarkdownV2 parse mode: the text and its entities, or the parser's refusal in TDLib's words. A backslash escapes
 *  any ASCII character; outside code every one of `_*[]()~`>#+-=|{}.!` that opens no mark must be escaped; inside code
 *  only the backquote is reserved. */
export function parseMarkdownV2(input: string): Formatted | { error: string } {
  let out = '';
  const entities: Entity[] = [];
  const nested: Array<{ mark: Mark; argument: string; offset: number; at: number }> = [];
  const unended = (e: { mark: Mark; at: number }): { error: string } => ({ error: `Can't find end of ${MARK_NAME[e.mark]} entity at byte offset ${bytes(input.slice(0, e.at))}` });
  let haveBlockquote = false;
  let canStartBlockquote = true;
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;
    const next = input.charCodeAt(i + 1);
    const top = nested.at(-1);
    const inCode = top !== undefined && (top.mark === 'code' || top.mark === 'pre' || top.mark === 'pre_code');
    const escaped = c === '\\' && next > 0 && next <= 126;
    if (escaped || !(inCode ? '`' : RESERVED).includes(c)) {
      if (escaped) i++;
      out += input[i];
      // a quotation starts only at a line's start
      if (input[i] !== '\r') canStartBlockquote = escaped && input[i] === '\n';
      continue;
    }
    const twice = input[i + 1] === c;
    // a line that does not go on with > ends the quotation
    const closes = top !== undefined && ((haveBlockquote && c === '\n' && input[i + 1] !== '>') || closesMark(top.mark, c, twice, input[i + 2]));
    if (!closes) {
      if (c === '\n') { out += c; canStartBlockquote = true; continue; }
      // a quotation's next line goes on the quotation already open
      if (c === '>' && canStartBlockquote && haveBlockquote) continue;
      const mark: Mark | undefined = c === '_' ? (twice ? 'underline' : 'italic') : c === '*' ? 'bold' : c === '~' ? 'strikethrough' : c === '|' && twice ? 'spoiler' : c === '[' ? 'text_link'
        : c === '`' ? (twice && input[i + 2] === '`' ? 'pre' : 'code') : c === '!' && input[i + 1] === '[' ? 'custom_emoji' : c === '>' && canStartBlockquote ? 'blockquote' : undefined;
      if (!mark) return { error: `Character '${c}' is reserved and must be escaped with the preceding '\\'` };
      const at = i;
      let argument = '';
      if (mark === 'underline' || mark === 'spoiler' || mark === 'custom_emoji') i++;
      if (mark === 'pre') {
        i += 3;
        // a language is the word right after the opening, ended by a space or a new line
        let end = i;
        while (end < input.length && !SPACE.test(input[end]!) && input[end] !== '`') end++;
        if (i !== end && end < input.length && input[end] !== '`') { argument = input.slice(i, end); i = end; }
        // one new line at the start of the block is skipped
        if (input[i] === '\n' || input[i] === '\r') i += (input[i + 1] === '\n' || input[i + 1] === '\r') && input[i] !== input[i + 1] ? 2 : 1;
        i--;
      }
      haveBlockquote ||= mark === 'blockquote';
      nested.push({ mark: mark === 'pre' && argument ? 'pre_code' : mark, argument, offset: out.length, at });
      continue;
    }
    // a mark closes
    const open = top!;
    let type: string = open.mark;
    if (c === '\n' && open.mark !== 'blockquote') {
      // only || ending a quotation's line closes there, and makes the quotation expandable
      if (open.mark !== 'spoiler' || !(open.at === i - 2 || (open.at === i - 3 && out.endsWith('\r')))) return unended(open);
      nested.pop();
      if (nested.at(-1)!.mark !== 'blockquote') return unended(nested.at(-1)!);
      type = 'expandable_blockquote';
    }
    const cur = nested.at(-1)!;
    let skip = out.length === cur.offset;
    let made: Entity | undefined;
    if (type === 'underline' || type === 'spoiler') i++;
    if (type === 'pre' || type === 'pre_code') i += 2;
    if (type === 'text_link' || type === 'custom_emoji') {
      // a link's address follows in parentheses (a text link with none links its own text)
      if (type === 'custom_emoji' && input[i + 1] !== '(') return { error: 'The entity must contain a tg://emoji or tg://time URL' };
      const address = input[i + 1] === '(' ? addressAt(input, i + 2) : { url: out.slice(cur.offset), end: i };
      if ('error' in address) return address;
      i = address.end;
      const link = type === 'text_link' ? linkOf(address.url) : undefined;
      const emoji = type === 'custom_emoji' ? emojiOf(address.url) : undefined;
      const time = type === 'custom_emoji' && !emoji ? timeOf(address.url) : undefined;
      if (type === 'custom_emoji' && !emoji && !time) return { error: 'Invalid tg://emoji or tg://time URL specified' };
      made = link ? linkEntity(link, cur.offset, 0) : emoji ? { type: 'custom_emoji', offset: cur.offset, length: 0, custom_emoji_id: emoji } : time ? { type: 'date_time', offset: cur.offset, length: 0, ...time } : undefined;
      // an address that is no link leaves its text plain
      skip ||= !made;
    }
    if (type === 'blockquote' || type === 'expandable_blockquote') {
      // the line's end is the quotation's last character
      haveBlockquote = false;
      out += c;
      canStartBlockquote = true;
      skip = false;
    }
    const length = out.length - cur.offset;
    if (!skip) entities.push(made ? { ...made, length } : type === 'pre_code' ? { type: 'pre', offset: cur.offset, length, language: cur.argument } : { type, offset: cur.offset, length });
    nested.pop();
  }
  if (haveBlockquote) {
    // a quotation that ends the text with || is expandable
    const expandable = nested.at(-1)!.mark === 'spoiler' && nested.at(-1)!.at === input.length - 2;
    if (expandable) nested.pop();
    const quote = nested.at(-1)!;
    if (quote.mark === 'blockquote' && out.length !== quote.offset) entities.push({ type: expandable ? 'expandable_blockquote' : 'blockquote', offset: quote.offset, length: out.length - quote.offset });
    if (quote.mark === 'blockquote') nested.pop();
  }
  if (nested.length) return unended(nested.at(-1)!);
  return { text: out, entities: sortEntities(entities) };
}

/** The legacy Markdown parse mode: *bold*, _italic_, `code`, ```pre``` (a language after its opening), [text](link),
 *  none nested; a backslash escapes only _ * ` and [. The text and its entities, or the parser's refusal in TDLib's
 *  words. */
export function parseMarkdown(input: string): Formatted | { error: string } {
  let out = '';
  const entities: Entity[] = [];
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;
    // a backslash escapes a mark's character outside an entity
    if (c === '\\' && input[i + 1] !== undefined && '_*`['.includes(input[i + 1]!)) i++;
    if (c === '\\' || !'_*`['.includes(c)) { out += input[i]; continue; }
    const begin = i;
    const endChar = c === '[' ? ']' : c;
    const pre = c === '`' && input[i + 1] === '`' && input[i + 2] === '`';
    let language = '';
    i += pre ? 3 : 1;
    if (pre) {
      // a language is the word right after the opening, ended by a space or a new line
      let end = i;
      while (end < input.length && !SPACE.test(input[end]!) && input[end] !== '`') end++;
      if (i !== end && end < input.length && input[end] !== '`') { language = input.slice(i, end); i = end; }
      // one new line at the start of the block is skipped
      if (input[i] === '\n' || input[i] === '\r') i += (input[i + 1] === '\n' || input[i + 1] === '\r') && input[i] !== input[i + 1] ? 2 : 1;
    }
    const offset = out.length;
    while (i < input.length && (input[i] !== endChar || (pre && !(input[i + 1] === '`' && input[i + 2] === '`')))) out += input[i++];
    if (i === input.length) return { error: `Can't find end of the entity starting at byte offset ${bytes(input.slice(0, begin))}` };
    const length = out.length - offset;
    // a link's address follows in parentheses (one with none links its own text); an empty entity is no entity
    const close = c === '[' && length && input[i + 1] === '(' ? input.indexOf(')', i + 2) : -1;
    const url = c !== '[' || !length ? '' : input[i + 1] === '(' ? input.slice(i + 2, close < 0 ? input.length : close) : input.slice(begin + 1, i);
    if (c === '[' && length && input[i + 1] === '(') i = close < 0 ? input.length : close;
    const link = url ? linkOf(url) : undefined;
    const made: Entity | undefined = !length ? undefined : c === '_' ? { type: 'italic', offset, length } : c === '*' ? { type: 'bold', offset, length }
      : c === '`' ? (pre ? { type: 'pre', offset, length, ...(language ? { language } : {}) } : { type: 'code', offset, length }) : link ? linkEntity(link, offset, length) : undefined;
    if (made) entities.push(made);
    if (pre) i += 2;
  }
  return { text: out, entities: sortEntities(entities) };
}

/** Entities in TDLib's order: by offset, the longer first. */
export function sortEntities(entities: Entity[]): Entity[] {
  return [...entities].sort((a, b) => a.offset - b.offset || b.length - a.length);
}

const WORD = /[\p{L}\p{N}_]/u;
const isWord = (ch: string | undefined): boolean => ch !== undefined && WORD.test(ch);

/** The entities the server finds in a text by itself: mentions (@name, 2-32 letters, digits and underscores, not
 *  inside a word), bot commands (/command, 1-64, optionally @bot), hashtags (#tag with a letter), cashtags ($ABC),
 *  links (http, https, or www.) and e-mail addresses. Where the twin stops: TDLib's own link matcher also takes bare
 *  domains by their top-level domain, and finds bank card numbers; the twin does not. */
export function findEntities(text: string, skipBotCommands: boolean): Entity[] {
  const found: Entity[] = [];
  const scan = (re: RegExp, type: string, ok: (m: RegExpExecArray) => boolean = () => true): void => {
    for (const m of text.matchAll(re)) {
      const at = m.index!;
      if (!ok(m as RegExpExecArray)) continue;
      found.push({ type, offset: at, length: m[0].length });
    }
  };
  scan(/@[A-Za-z0-9_]{2,32}/g, 'mention', (m) => !isWord(text[m.index! - 1]) && !isWord(text[m.index! + m[0].length]) && (m[0].length - 1 >= 4 || ['gif', 'nft', 'pic', 'ufc', 'vid'].includes(m[0].slice(1).toLowerCase())));
  const commandEdge = (ch: string | undefined): boolean => ch !== undefined && (isWord(ch) || '/<>'.includes(ch));
  if (!skipBotCommands) scan(/\/[A-Za-z0-9_]{1,64}(?:@[A-Za-z0-9_]{3,32})?/g, 'bot_command', (m) => !commandEdge(text[m.index! - 1]) && !commandEdge(text[m.index! + m[0].length]));
  scan(/#[\p{L}\p{N}_]{1,256}/gu, 'hashtag', (m) => !isWord(text[m.index! - 1]) && /\p{L}/u.test(m[0]) && text[m.index! + m[0].length] !== '#');
  scan(/\$[A-Z]{1,8}/g, 'cashtag', (m) => !isWord(text[m.index! - 1]) && text[m.index! - 1] !== '$' && !isWord(text[m.index! + m[0].length]));
  scan(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, 'email');
  scan(/\b(?:https?:\/\/|www\.)[^\s<>"]+/gi, 'url', (m) => !found.some((e) => e.type === 'email' && m.index! < e.offset + e.length && e.offset < m.index! + m[0].length));
  // a link ends before trailing punctuation
  for (const e of found) if (e.type === 'url') while (e.length > 1 && /[.,;:!?)\]'"]/.test(text[e.offset + e.length - 1]!)) e.length--;
  return found;
}

/** What the server keeps of a formatted text (TDLib's fix_formatted_text): whitespace trimmed from both ends (the
 *  entities moved and cut with it), the entities it finds itself added where they cross none given, sorted. Empty
 *  is the caller's to refuse. */
export function finish(f: Formatted, opts: { find: boolean; skipBotCommands: boolean }): Formatted {
  let text = f.text;
  let entities = f.entities.map((e) => ({ ...e }));
  // rtrim: the text ends at its last character that is not white space, every entity cut there
  const lastNonSpace = text.search(/\S\s*$/);
  if (lastNonSpace < 0) return { text: '', entities: [] };
  text = text.slice(0, lastNonSpace + 1);
  entities = entities.filter((e) => e.offset < text.length).map((e) => ({ ...e, length: Math.min(e.length, text.length - e.offset) }));
  // ltrim: spaces and newlines before the first entity
  const firstEntity = entities.length ? Math.min(...entities.map((e) => e.offset)) : text.length;
  let lead = 0;
  while (lead < firstEntity && (text[lead] === ' ' || text[lead] === '\n')) lead++;
  if (lead) { text = text.slice(lead); entities = entities.map((e) => ({ ...e, offset: e.offset - lead })); }
  if (opts.find) {
    for (const e of findEntities(text, opts.skipBotCommands)) {
      const crosses = entities.some((g) => e.offset < g.offset + g.length && g.offset < e.offset + e.length && (['code', 'pre', 'text_link', 'text_mention', 'custom_emoji', 'date_time', 'url', 'email', 'mention', 'bot_command', 'hashtag', 'cashtag'].includes(g.type) || e.offset < g.offset || e.offset + e.length > g.offset + g.length));
      if (!crosses) entities.push(e);
    }
  }
  return { text, entities: sortEntities(entities) };
}
