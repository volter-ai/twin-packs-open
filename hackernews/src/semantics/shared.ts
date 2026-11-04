// What both lanes of Hacker News share: one store of items and users, which the site (news.ycombinator.com) writes as
// people use it and the read API (hacker-news.firebaseio.com/v0) answers, so a story submitted on the site is at
// /v0/item/<id>.json and in newstories the moment it is made.
//
// THE STATE, in the read API's own shapes (api/spec, from the API's README): an `item` (a story or a comment: id, type,
// by, time, title, url, text, score, kids, parent, descendants) and a `user` (id, created, karma, about, submitted).
// The values the API answers as fields are stored on the subject by the write that changes them (a story's score and
// descendants, a comment's place in its parent's kids, a user's karma and submitted), never derived at read. What the
// site keeps that the API never answers is bookkeeping: a vote (`_vote`), a comment's points (`_points`) and the story
// a comment is under (`_story`), each person's password hash (the kernel's `_person`) and their sign-ins
// (`_web_session`, issued and ended by the kernel's browser session kit).
//
// HACKER NEWS'S OWN MOVES, each cited where it is made: ranking by points and age (newsfaq), the Show HN and Ask HN
// lists (newsfaq, showhn), a repost sent to the story it repeats (newsfaq), a thread closed after two weeks (newsfaq),
// karma from upvotes (newsfaq), goto kept on the site (security).
import { startBrowserSession, endBrowserSession, personOf, personWith, recordPerson, type HandlerContext } from '@volter/world-core';

export type Row = Record<string, unknown>;
export type { HandlerContext };
type Reader = Pick<HandlerContext, 'row' | 'rowsRaw' | 'own'>;

export const ITEM = 'item';
export const USER = 'user';
export const VOTE = '_vote';
/** Hacker News's session cookie. */
export const COOKIE = 'user';
/** The implicit organization's retained Hacker News handle. */
export const WORLD_ACCOUNT = 'yuerany';
export const SITE = 'https://news.ycombinator.com';

/** An instant of the World clock as Hacker News writes time: Unix seconds. */
export const unixOf = (iso: string): number => Math.floor(Date.parse(iso) / 1000);

/** A stored row as the API answers it: the vendor's own fields, no bookkeeping. */
export function wire(ctx: Pick<HandlerContext, 'own'>, row: Row): Row {
  const own = ctx.own(row);
  // a user's id is their username, the subject's own id, which the kernel keeps as the subject's
  return Object.fromEntries(Object.entries({ ...(own.id === undefined ? { id: row.id } : {}), ...own }).filter(([k]) => !k.startsWith('_') && k !== 'deleted' && k !== 'updatedAt'));
}

export const itemRow = (ctx: Reader, id: unknown): Row | undefined => (/^\d+$/.test(String(id)) ? ctx.row(ITEM, String(id)) : undefined);
export const userRow = (ctx: Reader, name: string): Row | undefined => ctx.row(USER, name);
/** Every item, as the API answers it. */
export const allItems = (ctx: Reader): Row[] => ctx.rowsRaw(ITEM).map((r) => wire(ctx, r));
export const itemOf = (ctx: Reader, id: unknown): Row | undefined => { const r = itemRow(ctx, id); return r ? wire(ctx, r) : undefined; };
export const userOf = (ctx: Reader, name: string): Row | undefined => { const r = userRow(ctx, name); return r ? wire(ctx, r) : undefined; };

// ── what Hacker News lists ─────────────────────────────────────────────────────────────────────

const isStory = (i: Row): boolean => i.type === 'story' && i.dead !== true;
// source: https://news.ycombinator.com/showhn.html "To post, submit a story whose title begins with"
export const isShow = (i: Row): boolean => isStory(i) && String(i.title ?? '').startsWith('Show HN');
// source: https://news.ycombinator.com/newsfaq.html "Ask HN lists questions and other text submissions."
export const isAsk = (i: Row): boolean => isStory(i) && !i.url && !isShow(i);

/** A post's rank at an instant: Hacker News's frontpage-rank, from the source of the site it published (news.arc, in
 *  the Arc distribution, arclanguage/anarki's official branch). */
// source: https://news.ycombinator.com/newsfaq.html "The basic algorithm divides points by a power of the time since a story was submitted."
// source: https://raw.githubusercontent.com/arclanguage/anarki/622704867effa642c99ecf6aefc6a5f5f698650a/news.arc "(= gravity* 1.8 timebase* 120 front-threshold* 1 nourl-factor* .4 lightweight-factor* .3 )"
// source: https://raw.githubusercontent.com/arclanguage/anarki/622704867effa642c99ecf6aefc6a5f5f698650a/news.arc "(* (/ (let base (- (scorefn s) 1) (if (> base 0) (expt base .8) base)) (expt (/ (+ (item-age s) timebase*) 60) gravity))"
// source: https://raw.githubusercontent.com/arclanguage/anarki/622704867effa642c99ecf6aefc6a5f5f698650a/news.arc "(if (no (in s!type 'story 'poll)) .5 (blank s!url) nourl-factor*"
// Where the source stops for a World: its other factors (a controversial thread's, a lightweight site's, sock-puppet
// votes, moderation) read state the World does not keep, and count as 1.
export function rank(item: Row, points: number, now: number): number {
  const base = points - 1;
  const ageMinutes = Math.max(0, now - Number(item.time)) / 60;
  const factor = item.type !== 'story' && item.type !== 'poll' ? 0.5 : !item.url ? 0.4 : 1;
  return ((base > 0 ? base ** 0.8 : base) / ((ageMinutes + 120) / 60) ** 1.8) * factor;
}
const byRank = (now: number) => (a: Row, b: Row): number => rank(b, Number(b.score ?? 1), now) - rank(a, Number(a.score ?? 1), now) || Number(b.id) - Number(a.id);
const byNewest = (a: Row, b: Row): number => Number(b.time) - Number(a.time) || Number(b.id) - Number(a.id);

/** The front page: stories by rank. */
export const frontPage = (ctx: Reader, now: number): Row[] => allItems(ctx).filter(isStory).sort(byRank(now));
/** newest: stories, newest first. */
export const newest = (ctx: Reader): Row[] => allItems(ctx).filter(isStory).sort(byNewest);
// source: https://news.ycombinator.com/showhn.html "Every Show HN appears on shownew."
export const showNew = (ctx: Reader): Row[] => allItems(ctx).filter(isShow).sort(byNewest);
// source: https://news.ycombinator.com/showhn.html "Once it clears a small points threshold, it will appear on the show page in the top bar."
// Where the documentation stops: the threshold is not stated. The twin's is the least it can be: a point beyond the
// submitter's own.
export const showPage = (ctx: Reader, now: number): Row[] => allItems(ctx).filter((i) => isShow(i) && Number(i.score ?? 1) > 1).sort(byRank(now));
// source: https://news.ycombinator.com/newsfaq.html "All Ask HNs appear on newest and asknew"
export const askNew = (ctx: Reader): Row[] => allItems(ctx).filter(isAsk).sort(byNewest);
// source: https://raw.githubusercontent.com/arclanguage/anarki/622704867effa642c99ecf6aefc6a5f5f698650a/news.arc "(bestn n (compare > realscore) (visible user stories*))"
// the newer first among equals
export const best = (ctx: Reader): Row[] => allItems(ctx).filter(isStory).sort((a, b) => Number(b.score ?? 1) - Number(a.score ?? 1) || byNewest(a, b));
/** The ids of a list. */
export const ids = (rows: Row[], max: number): number[] => rows.slice(0, max).map((r) => Number(r.id));

// ── people and their sign-ins ──────────────────────────────────────────────────────────────────

/** The cookie a request carries, as a browser sends it back. */
function cookieValue(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === name) return decodeURIComponent(part.slice(at + 1).trim());
  }
  return undefined;
}

/** The username the request's `user` cookie signs in, or undefined. */
export function signedInAs(ctx: HandlerContext): string | undefined {
  const token = cookieValue(ctx.call.request, COOKIE);
  const session = token ? ctx.rowsRaw('_web_session').find((s) => s.token === token) : undefined;
  const person = session ? personOf(ctx, String(session.email)) : undefined;
  return person ? String(person.acct) : undefined;
}

/** Signed in: a session recorded as @volter/world-ui's kit records one (its `_web_session` row, its token a World
 *  secret), the `user` cookie set, and on to `next`. */
export async function beginSession(ctx: HandlerContext, acct: string, next: string): Promise<Response> {
  return new Response(null, { status: 302, headers: { location: onSite(ctx, next), 'set-cookie': await sessionCookie(ctx, acct) } });
}

/** A new sign-in's cookie: its session recorded as the kit records one. */
async function sessionCookie(ctx: HandlerContext, acct: string): Promise<string> {
  const email = acct.toLowerCase();
  return startBrowserSession(ctx, email, COOKIE);
}

/** The account whose username and password these are. */
export const accountWith = (ctx: HandlerContext, acct: string, pw: string): string | undefined => {
  const person = personWith(ctx, acct, pw);
  return person ? String(person.acct) : undefined;
};

/** Why a new account cannot be made with this username and password, or undefined: the site's own rules, from the
 *  app.arc its news.arc loads. */
export function accountRefusal(ctx: HandlerContext, acct: string, pw: string): string | undefined {
  // source: https://raw.githubusercontent.com/arclanguage/anarki/622704867effa642c99ecf6aefc6a5f5f698650a/app.arc "(if (no (goodname user 2 15))"
  // source: https://raw.githubusercontent.com/arclanguage/anarki/622704867effa642c99ecf6aefc6a5f5f698650a/app.arc "Usernames can only contain letters, digits, dashes and underscores, and should be between 2 and 15 characters long."
  // source: https://news.ycombinator.com/security.html "Usernames with trailing newlines were getting through."
  if (!/^[A-Za-z0-9_-]{2,15}$/.test(acct)) return badUsername();
  // source: https://raw.githubusercontent.com/arclanguage/anarki/622704867effa642c99ecf6aefc6a5f5f698650a/app.arc "That username is taken. Please choose another."
  if (personOf(ctx, acct) || userRow(ctx, acct)) return usernameTaken();
  // source: https://raw.githubusercontent.com/arclanguage/anarki/622704867effa642c99ecf6aefc6a5f5f698650a/app.arc "(or (no pw) (< (len pw) 4))"
  // source: https://raw.githubusercontent.com/arclanguage/anarki/622704867effa642c99ecf6aefc6a5f5f698650a/app.arc "Passwords should be a least 4 characters long."
  if (pw.length < 4) return shortPassword();
  return undefined;
}

// each refusal's words in a function of its own, so a refusal no step draws is measured as not drawn
function badUsername(): string {
  return 'Usernames can only contain letters, digits, dashes and underscores, and should be between 2 and 15 characters long.  Please choose another.';
}
function usernameTaken(): string {
  return 'That username is taken. Please choose another.';
}
function shortPassword(): string {
  return 'Passwords should be a least 4 characters long.  Please choose another.';
}

/** A new account: the person who signs in with it, and the user the API answers once it has public activity. */
export async function makeAccount(ctx: HandlerContext, acct: string, pw: string): Promise<boolean> {
  // source: https://news.ycombinator.com/newsfaq.html "Roughly, the number of upvotes on their posts minus the number of downvotes."
  // source: https://raw.githubusercontent.com/arclanguage/anarki/622704867effa642c99ecf6aefc6a5f5f698650a/news.arc "karma      1"
  const made = await ctx.createUnique(USER, { id: acct, _username_key: acct.toLowerCase(), created: unixOf(ctx.occurredAt), karma: 1 }, 'user.create', { id: acct });
  if (!made.created) return false;
  await recordPerson(ctx, acct, pw, { acct });
  return true;
}

/** A page of the site to return to: a page of its own, never another site. */
// source: https://news.ycombinator.com/security.html "goto parameters functioned as open redirects."
// source: https://news.ycombinator.com/security.html "An open redirect was possible by passing a URL with a mixed-case protocol as the goto parameter."
// a page of the site: a name (showhn.html too) and its query, never a scheme, a host or a path from the root
export const gotoOf = (raw: unknown, fallback = 'news'): string => {
  const at = String(raw ?? '');
  return /^[a-z][a-z0-9._-]*(?:\?[^\s:]*)?$/i.test(at) ? at : fallback;
};

/** The link tokens a page carries for the person it is drawn for: a vote's `auth`, a comment form's `hmac`, the submit
 *  form's `fnid`, each a World secret so no one else can make one. */
type Minter = Pick<HandlerContext, 'secret' | 'crypto'>;
/** A token of forty hex digits, as the site's links carry them, drawn from the World's secret for `label`. */
const token = async (ctx: Minter, label: string): Promise<string> => ctx.crypto.digest('sha256', await ctx.secret(label), 'hex').slice(0, 40);
export const voteAuth = (ctx: Minter, user: string, id: number | string): Promise<string> => token(ctx, `vote:${user}:${id}`);
export const commentHmac = (ctx: Minter, user: string, parent: number | string): Promise<string> => token(ctx, `comment:${user}:${parent}`);
export const submitFnid = async (ctx: Minter, user: string): Promise<string> => (await token(ctx, `submit:${user}`)).slice(0, 22);

// ── what people write ──────────────────────────────────────────────────────────────────────────

/** The story the item is, or is under. */
export const storyOf = (ctx: Reader, item: Row): Row | undefined => (item.type === 'story' ? item : itemOf(ctx, (itemRow(ctx, item.id) ?? {})._story));

/** A user's submissions, newest first, with a new one. */
async function submitted(ctx: HandlerContext, by: string, id: number): Promise<void> {
  const user = userRow(ctx, by);
  await ctx.write(USER, by, { submitted: [id, ...((user?.submitted as number[] | undefined) ?? [])] }, 'user.submitted');
}

/** Where a url that begins at `i` ends: the site's own rule (app.arc's urlend). Punctuation followed by a space or the
 *  text's end is not the url's; an opening bracket is, unless a space or punctuation follows it; a closing bracket is
 *  when it balances an opening one in the url. */
// source: https://raw.githubusercontent.com/arclanguage/anarki/622704867effa642c99ecf6aefc6a5f5f698650a/app.arc "Returns the index of the first char not part of the url beginning"
// source: https://raw.githubusercontent.com/arclanguage/anarki/622704867effa642c99ecf6aefc6a5f5f698650a/app.arc "(and (punc c) (whitec (s (+ i 1))))"
// source: https://raw.githubusercontent.com/arclanguage/anarki/622704867effa642c99ecf6aefc6a5f5f698650a/app.arc "Treats a delimiter as part of a url if it is (a) an open delimiter"
export function urlEnd(s: string, start: number): number {
  const punc = (c: string | undefined): boolean => c !== undefined && '.,;:!?'.includes(c);
  const white = (c: string | undefined): boolean => c !== undefined && ' \n\t\r'.includes(c);
  const open = (c: string | undefined): boolean => c !== undefined && '<([{'.includes(c);
  const close = (c: string | undefined): boolean => c !== undefined && '>)]}'.includes(c);
  let indelim = false;
  for (let i = start; ; i++) {
    const c = s[i];
    // the last character (app.arc's atend: i > len - 2)
    if (i > s.length - 2) {
      if (c === undefined || punc(c) || white(c) || open(c)) return i;
      if (close(c)) return indelim ? i + 1 : i;
      return i + 1;
    }
    const next = s[i + 1];
    if (white(c) || (punc(c) && white(next)) || ((white(next) || punc(next)) && (open(c) || (close(c) && !indelim)))) return i;
    indelim = open(c) || (indelim && !close(c));
  }
}

/** Where indented code begins at `i`, after a paragraph break (two newlines) and two spaces or more: the index of its
 *  first character and the spaces before it (app.arc's indented-code). */
// source: https://raw.githubusercontent.com/arclanguage/anarki/622704867effa642c99ecf6aefc6a5f5f698650a/app.arc "(if (and (> newlines 1) (> spaces 1)) (list i spaces) nil)"
export function indentedCode(s: string, i: number, newlines: number): [number, number] | undefined {
  let spaces = 0;
  for (let at = i; ; at++) {
    const c = s[at];
    if (c !== undefined && !/\s/.test(c)) return newlines > 1 && spaces > 1 ? [at, spaces] : undefined;
    if (at > s.length - 2) return undefined;
    if (c === '\n') { newlines++; spaces = 0; } else spaces++;
  }
}

/** The code that follows `i`: every character up to a newline before a line that is not indented, or the end
 *  (app.arc's code-block). */
// source: https://raw.githubusercontent.com/arclanguage/anarki/622704867effa642c99ecf6aefc6a5f5f698650a/app.arc "(and (> left 2) (is (s (+ i 1)) #\newline) (nonwhite (s (+ i 2))))))"
export function codeBlock(s: string, i: number): string {
  let out = '';
  for (;;) {
    const left = s.length - i - 1;
    if (left <= 0 || (left > 2 && s[i + 1] === '\n' && !/\s/.test(s[i + 2]!))) return out;
    out += s[++i];
  }
}

/** What a person typed, as the item's text holds it: HTML, by the site's own markdown (app.arc), read character by
 *  character: a blank line is a paragraph break, an asterisk followed by a non-space (with another to come) opens
 *  italics and the next asterisk closes them, a url anywhere is a link (in a comment, not a submission's text) whose
 *  text is cut at 60 characters, its address whole. */
// source: https://news.ycombinator.com/formatdoc "Blank lines separate paragraphs."
// source: https://news.ycombinator.com/formatdoc "Urls become links, except in the text field of a submission."
// source: https://raw.githubusercontent.com/arclanguage/anarki/622704867effa642c99ecf6aefc6a5f5f698650a/app.arc "(markdown (trim (rem #\return (esc-tags str)) 'end) 60 nolinks))"
// source: https://raw.githubusercontent.com/arclanguage/anarki/622704867effa642c99ecf6aefc6a5f5f698650a/app.arc "(and (is (s i) #\*) (or ital (atend i s) (and (~whitec (s (+ i 1))) (pos #\* s (+ i 1)))))"
// source: https://raw.githubusercontent.com/arclanguage/anarki/622704867effa642c99ecf6aefc6a5f5f698650a/app.arc "(or (litmatch \"http://\" s i) (litmatch \"https://\" s i)))"
// source: https://raw.githubusercontent.com/arclanguage/anarki/622704867effa642c99ecf6aefc6a5f5f698650a/app.arc "(pr (if (no maxurl) url (ellipsize url maxurl))))"
// source: https://raw.githubusercontent.com/arclanguage/anarki/622704867effa642c99ecf6aefc6a5f5f698650a/arc.arc "(+ (cut str 0 limit) \"...\")))"
// source: https://raw.githubusercontent.com/arclanguage/anarki/622704867effa642c99ecf6aefc6a5f5f698650a/app.arc "(do (pr  \"<p><pre><code>\")"
// Where the source stops for the twin: the characters are escaped as the API answers them, a slash as &#x2F;.
export function formatText(typed: string, links: boolean): string {
  const esc1 = (t: string): string => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;').replace(/\//g, '&#x2F;');
  const white = (c: string | undefined): boolean => c !== undefined && /\s/.test(c);
  const s = typed.replace(/\r/g, '').replace(/\s+$/, '');
  let out = '';
  let ital = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    // indented code: after a paragraph break, a line indented by two spaces or more, kept as typed to the next line
    // that is not indented
    const code = indentedCode(s, i, i === 0 ? 2 : 0);
    if (code) {
      const cb = codeBlock(s, code[0] - code[1] - 1);
      out += `<p><pre><code>${esc1(cb)}</code></pre>`;
      i = code[0] - code[1] - 1 + cb.length;
      continue;
    }
    // a paragraph break: a run of whitespace holding two newlines before the next character (app.arc's parabreak)
    if (white(c)) {
      let j = i;
      let newlines = i === 0 ? 1 : 0;
      while (j < s.length && white(s[j])) { if (s[j] === '\n') newlines++; j++; }
      if (newlines > 1 && j < s.length) {
        if (i > 0) out += '<p>';
        i = j - 1;
        continue;
      }
    }
    if (c === '*' && (ital || i === s.length - 1 || (!white(s[i + 1]) && s.indexOf('*', i + 1) >= 0))) {
      out += ital ? '</i>' : '<i>';
      ital = !ital;
      continue;
    }
    if (links && (s.startsWith('http://', i) || s.startsWith('https://', i))) {
      const end = urlEnd(s, i);
      const url = s.slice(i, end);
      out += `<a href="${esc1(url)}" rel="nofollow">${esc1(url.length <= 60 ? url : `${url.slice(0, 60)}...`)}</a>`;
      i = end - 1;
      continue;
    }
    out += esc1(c);
  }
  return out;
}

/** A story: its first point is its submitter's. */
export async function postStory(ctx: HandlerContext, by: string, fields: { title: string; url?: string; text?: string }): Promise<number> {
  const id = Number(ctx.mint(ITEM));
  // source: https://news.ycombinator.com/newsfaq.html "How do I submit a question? Use the submit link in the top bar, and leave the url field blank."
  await ctx.write(ITEM, String(id), { id, type: 'story', by, time: unixOf(ctx.occurredAt), title: fields.title, ...(fields.url ? { url: fields.url } : {}), ...(fields.text ? { text: formatText(fields.text, false) } : {}), score: 1, descendants: 0 }, 'item.story');
  await submitted(ctx, by, id);
  return id;
}

/** A parent's comments in ranked display order at this instant: Hacker News sorts a thread's kids by the same rank. */
// source: https://news.ycombinator.com/newsfaq.html "Comments in threads are ranked the same way."
// source: https://raw.githubusercontent.com/arclanguage/anarki/622704867effa642c99ecf6aefc6a5f5f698650a/news.arc "(each k (sort (compare > frontpage-rank:item) c!kids)"
export function rankedKids(ctx: Reader, parent: unknown, now: number): number[] {
  return ctx.rowsRaw(ITEM).filter((r) => Number(r.parent) === Number(parent) && r.dead !== true).map((r) => ({ r, w: wire(ctx, r) }))
    .sort((a, b) => rank(b.w, Number(b.r._points ?? 1), now) - rank(a.w, Number(a.r._points ?? 1), now) || Number(b.w.time) - Number(a.w.time) || Number(b.w.id) - Number(a.w.id))
    .map((x) => Number(x.w.id));
}

/** An item as the API answers it at this instant: its kids in ranked display order as they stand now, the README's
 *  ranked display order being the rank at the moment it is read. */
// source: spec:/components/schemas/Item/properties/kids "The ids of the item's comments, in ranked display order."
export function itemAt(ctx: Reader, id: unknown, now: number): Row | undefined {
  const item = itemOf(ctx, id);
  if (!item || !Array.isArray(item.kids)) return item;
  return { ...item, kids: rankedKids(ctx, item.id, now) };
}

/** A comment on a story or a reply to a comment: the parent's kids ranked again, the story's descendants counted. */
export async function postComment(ctx: HandlerContext, by: string, parent: Row, text: string): Promise<number> {
  const id = Number(ctx.mint(ITEM));
  const now = unixOf(ctx.occurredAt);
  const story = storyOf(ctx, parent)!;
  await ctx.write(ITEM, String(id), { id, type: 'comment', by, time: now, parent: Number(parent.id), text: formatText(text, true), _points: 1, _story: Number(story.id) }, 'item.comment');
  await ctx.write(ITEM, String(parent.id), { kids: rankedKids(ctx, Number(parent.id), now) }, 'item.kids');
  // source: spec:/components/schemas/Item/properties/descendants "In the case of stories or polls, the total comment count."
  await ctx.write(ITEM, String(story.id), { descendants: Number(story.descendants ?? 0) + 1 }, 'item.descendants');
  await submitted(ctx, by, id);
  return id;
}

/** A comment as a person posts it: refused on a closed thread; an empty one sends the add comment page back. */
export async function commentAs(ctx: HandlerContext, user: string, parent: Row, text: string, goto: string): Promise<Response | undefined> {
  // source: https://news.ycombinator.com/newsfaq.html "Threads are closed to new comments after two weeks, or if the submission has been killed by software, moderators, or user flags."
  if (!threadOpen(storyOf(ctx, parent)!, unixOf(ctx.occurredAt))) return sitePage(ctx, 'Hacker News', '<p>Threads are closed to new comments after two weeks.</p>', user);
  // source: https://raw.githubusercontent.com/arclanguage/anarki/622704867effa642c99ecf6aefc6a5f5f698650a/news.arc "(empty text) (flink [addcomment-page parent (get-user _) whence text retry*])"
  if (!text) return emptyComment(ctx, user, parent, goto);
  await postComment(ctx, user, parent, text);
  return undefined;
}

/** An empty comment: the add comment page again, under the site's words. */
function emptyComment(ctx: HandlerContext, user: string, parent: Row, goto: string): Promise<Response> {
  return addCommentPage(ctx, user, parent, goto, '', tryAgain());
}

/** The site's refusals of a link or form it did not make for the person (another's, or stale), and of an id it does
 *  not hold, each a page under the bar. */
// source: https://raw.githubusercontent.com/arclanguage/anarki/622704867effa642c99ecf6aefc6a5f5f698650a/srv.arc "Unknown or expired link."
export function expiredLink(ctx: HandlerContext, user: string | undefined): Promise<Response> {
  return sitePage(ctx, 'Hacker News', '<p>Unknown or expired link.</p>', user);
}
// source: https://news.ycombinator.com/item?id=999999999999 "No such item."
export function noSuchItem(ctx: HandlerContext, user: string | undefined): Promise<Response> {
  return sitePage(ctx, 'Hacker News', '<p>No such item.</p>', user);
}
// Where the documentation stops: the words for a vote the site does not make (another direction, another's link)
export function cantVote(ctx: HandlerContext, user: string): Promise<Response> {
  return sitePage(ctx, 'Hacker News', "<p>Can't make that vote.</p>", user);
}

/** An upvote: the story's score or the comment's points, and its author's karma. */
export async function upvote(ctx: HandlerContext, voter: string, item: Row): Promise<void> {
  await ctx.record(VOTE, { user: voter, item: Number(item.id), at: ctx.occurredAt }, `${voter}:${item.id}`);
  const row = itemRow(ctx, item.id)!;
  if (item.type === 'story') await ctx.write(ITEM, String(item.id), { score: Number(item.score ?? 1) + 1 }, 'item.vote');
  else await ctx.write(ITEM, String(item.id), { _points: Number(row._points ?? 1) + 1 }, 'item.vote');
  // source: https://news.ycombinator.com/newsfaq.html "Roughly, the number of upvotes on their posts minus the number of downvotes."
  const author = userRow(ctx, String(item.by));
  if (author) await ctx.write(USER, String(item.by), { karma: Number(author.karma ?? 1) + 1 }, 'user.karma');
}

/** A person's upvote, counted once and never on their own post. */
// source: https://news.ycombinator.com/newsfaq.html "Why do I see an orange/red asterisk? It just means it's your own post."
export async function voteOnce(ctx: HandlerContext, voter: string, item: Row): Promise<void> {
  if (item.by !== voter && !hasVoted(ctx, voter, String(item.id))) await upvote(ctx, voter, item);
}

/** Whether this person has voted on the item. */
export const hasVoted = (ctx: Reader, voter: string, id: number | string): boolean => Boolean(ctx.row(VOTE, `${voter}:${id}`));

/** The live story a url was already submitted as, which a repost is sent to and counted as a vote for. */
// source: https://news.ycombinator.com/newsfaq.html "Otherwise we bury reposts as duplicates."
// source: https://raw.githubusercontent.com/arclanguage/anarki/622704867effa642c99ecf6aefc6a5f5f698650a/news.arc "(aif (and (~blank url) (live-story-w/url url)) (do (vote-for user it) (item-url it!id))"
// Where the source stops for a World: a site's canonical url (its query cut for some sites) is the url as submitted.
export function repostOf(ctx: Reader, url: string): Row | undefined {
  return allItems(ctx).filter((i) => isStory(i) && i.url === url).sort(byNewest)[0];
}

/** Why a submission is refused, as the submit page says it, or undefined. */
// source: https://raw.githubusercontent.com/arclanguage/anarki/622704867effa642c99ecf6aefc6a5f5f698650a/news.arc "(no (and (or (blank url) (valid-url url)) (~blank title)))"
// source: https://raw.githubusercontent.com/arclanguage/anarki/622704867effa642c99ecf6aefc6a5f5f698650a/news.arc "(len> title title-limit*)"
// source: https://raw.githubusercontent.com/arclanguage/anarki/622704867effa642c99ecf6aefc6a5f5f698650a/news.arc "(and (blank url) (blank text))"
export function submissionRefusal(title: string, url: string, text: string): string | undefined {
  if (!((url === '' || validUrl(url)) && title !== '')) return invalidSubmission();
  // source: https://raw.githubusercontent.com/arclanguage/anarki/622704867effa642c99ecf6aefc6a5f5f698650a/news.arc "toolong*     \"Please make title < @title-limit* characters.\""
  if (title.length > 80) return titleTooLong();
  if (url === '' && text === '') return bothBlank();
  return undefined;
}

function tryAgain(): string {
  return 'Please try again.';
}
function invalidSubmission(): string {
  return tryAgain();
}
function titleTooLong(): string {
  return 'Please make title < 80 characters.';
}
// source: https://raw.githubusercontent.com/arclanguage/anarki/622704867effa642c99ecf6aefc6a5f5f698650a/news.arc "The url and text fields can't both be blank."
function bothBlank(): string {
  return "The url and text fields can't both be blank.  Please either supply a url, or if you're asking a question, put it in the text field.";
}

/** A url the site takes: http or https, longer than ten characters, with no angle bracket or quote. */
// source: https://raw.githubusercontent.com/arclanguage/anarki/622704867effa642c99ecf6aefc6a5f5f698650a/html.arc "(and (len> url 10)"
// source: https://raw.githubusercontent.com/arclanguage/anarki/622704867effa642c99ecf6aefc6a5f5f698650a/html.arc "(begins url \"https://\")"
// source: https://raw.githubusercontent.com/arclanguage/anarki/622704867effa642c99ecf6aefc6a5f5f698650a/html.arc "(~find [in _ #\< #\>"
const validUrl = (url: string): boolean => url.length > 10 && /^https?:\/\//.test(url) && !/[<>"']/.test(url);

/** Whether a story's thread still takes comments. */
// source: https://news.ycombinator.com/newsfaq.html "Threads are closed to new comments after two weeks, or if the submission has been killed by software, moderators, or user flags."
export const threadOpen = (story: Row, now: number): boolean => story.dead !== true && now - Number(story.time) < 14 * 24 * 3600;

// ── where a page is reached ──────────────────────────────────────────────────────────────────
// At a World's place (a served or hosted World's /<org>/<world>/hackernews/…, `x-forwarded-prefix`), the site's pages,
// forms and moves name the twin's own base, never news.ycombinator.com, which a browser outside the World's proxy cannot
// reach (twin-world's architecture, "A page at a World's place"); on the site's own host the base is empty.

/** The twin's base path at a World's place ('' for a prefix of `/`), or undefined on the site's own host. */
export const placeOf = (ctx: Pick<HandlerContext, 'call' | 'publicBase'>): string | undefined =>
  (ctx.call.request.headers.has('x-forwarded-prefix') ? new URL(ctx.publicBase).pathname.replace(/\/+$/, '') : undefined);

/** A page of the site (`news`, `item?id=5`): written relative on its own host, as the site writes it; on the base at a
 *  World's place. */
export const onSite = (ctx: Pick<HandlerContext, 'call' | 'publicBase'>, page: string): string => {
  const base = placeOf(ctx);
  return base === undefined ? page : `${base}/${page.replace(/^\/+/, '')}`;
};

/** A page's HTML at a World's place: every link and form of the site (written relative, as the site writes them, or from
 *  its root) on the base; a link to another site is left as it is. On the site's own host, the page as written. */
export function placedHtml(html: string, base: string | undefined): string {
  if (base === undefined) return html;
  return html.replace(/(href|action)="(?!https?:|\/\/|#|mailto:|javascript:)\/?([^"]*)"/g, (_, attr: string, page: string) => `${attr}="${base}/${page}"`);
}

/** A move to a page of the site. */
export const moveTo = (ctx: Pick<HandlerContext, 'call' | 'publicBase'>, page: string): Response => new Response(null, { status: 302, headers: { location: onSite(ctx, page) } });

// ── the site's own answers, for a form its handler answers with a page ─────────────────────────

const esc = (v: unknown): string => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Hacker News's look: Verdana on its beige, the orange top bar. */
export const HN_CSS = `
body { margin: 0; font-family: Verdana, Geneva, sans-serif; font-size: 10pt; color: #000; background: #fff; }
.hn { width: 85%; margin: 8px auto 0; background: #f6f6ef; }
.hn-top { background: #ff6600; padding: 2px; display: flex; align-items: center; gap: 4px; line-height: 12pt; }
.hn-top a { color: #000; text-decoration: none; }
.hn-logo { border: 1px solid #fff; width: 18px; height: 18px; display: inline-flex; align-items: center; justify-content: center; color: #fff; font-weight: bold; font-size: 10pt; }
.hn-name { font-weight: bold; margin-right: 6px; }
.hn-right { margin-left: auto; padding-right: 4px; }
.hn-body { padding: 10px 8px 16px; }
.hn-body a { color: #000; text-decoration: none; }
.hn-sub, .hn-sub a { color: #828282; font-size: 7pt; }
.hn-rank { color: #828282; text-align: right; vertical-align: top; padding-right: 2px; }
.hn-arrow { vertical-align: top; width: 14px; text-align: center; }
.hn-arrow a { color: #9a9a9a; font-size: 9pt; }
.hn-title { font-size: 10pt; }
.hn-site, .hn-site a { color: #828282; font-size: 8pt; }
.hn-message { margin: 0 0 12px; }
.hn-comment { margin: 0 0 14px; }
.hn-comment .hn-text { font-size: 9pt; margin-top: 4px; }
.hn-reply { font-size: 7pt; text-decoration: underline; color: #000; }
textarea { font-family: monospace; font-size: 10pt; }
.hn table { border-collapse: collapse; }
`;

/** The link that signs a person out, as the top bar draws it beside their name: its own auth, back to `goto`. */
// source: https://raw.githubusercontent.com/arclanguage/anarki/622704867effa642c99ecf6aefc6a5f5f698650a/news.arc "(rlinkf 'logout (req) (when-umatch/r user req (logout-user user) whence))"
// source: https://news.ycombinator.com/security.html "Logout and login were vulnerable to CSRF."
export const logoutLink = async (ctx: Minter, user: string, goto: string): Promise<string> => `logout?auth=${await token(ctx, `logout:${user}`)}&goto=${encodeURIComponent(goto)}`;

/** Whether a logout link's auth is this person's. */
export const logoutAuthOf = (ctx: Minter, user: string): Promise<string> => token(ctx, `logout:${user}`);

/** A page of the site: the top bar (the person signed in, their karma and logout, or login back to `goto`) and its body. */
// source: https://raw.githubusercontent.com/arclanguage/anarki/622704867effa642c99ecf6aefc6a5f5f698650a/news.arc "(when showkarma (pr \"&nbsp;(@(karma user))\"))"
export async function sitePage(ctx: Pick<HandlerContext, 'call' | 'publicBase' | 'secret' | 'crypto' | 'row' | 'rowsRaw' | 'own'>, title: string, body: string, user: string | undefined, goto = 'news', status = 200): Promise<Response> {
  const karma = user ? userOf(ctx, user)?.karma : undefined;
  const right = user
    ? `<a href="user?id=${esc(user)}">${esc(user)}</a>&nbsp;(${esc(karma ?? 1)})&nbsp;|&nbsp;<a href="${esc(await logoutLink(ctx, user, goto))}">logout</a>`
    : `<a href="login?goto=${esc(encodeURIComponent(goto))}">login</a>`;
  const top = `<div class="hn-top"><a class="hn-logo" href="news">Y</a><b class="hn-name"><a href="news">Hacker News</a></b><a href="newest">new</a> | <a href="show">show</a> | <a href="submit">submit</a><span class="hn-right">${right}</span></div>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${esc(title)}</title><style>${HN_CSS}</style></head><body><div class="hn">${top}<div class="hn-body">${body}</div></div></body></html>`;
  return new Response(placedHtml(html, placeOf(ctx)), { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

/** A logout that signs no one out (nobody signed in, or a link not drawn for the person who is): on to the page, as the
 *  site's own logout goes. */
export function noOneSignedOut(ctx: HandlerContext, goto: string): Response {
  return moveTo(ctx, goto);
}

/** Signed out: the session the cookie names ended, its cookie cleared, and on to `goto`. */
export async function endSession(ctx: HandlerContext, goto: string): Promise<Response> {
  return new Response(null, { status: 302, headers: { location: onSite(ctx, goto), 'set-cookie': await endBrowserSession(ctx, COOKIE) } });
}

/** The page the site answers where a person must be signed in, or a sign-in was refused: what went wrong, and the login
 *  and create-account forms (acct, pw; creating=t), each posting to the address the page was drawn at (a vote's, the
 *  submit page's, the login page's own), as the site's action-less forms do. A bare page: no top bar. */
export function loginPage(ctx: Pick<HandlerContext, 'call' | 'publicBase'>, message: string, action?: string, carried: Record<string, string> = {}): Response {
  // a form with no action posts to the address it was drawn at, as the site's own do; what the person was posting when
  // asked to log in (a comment's parent and text) rides with it, so logging in finishes it
  const kept = Object.entries(carried).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('');
  const form = (heading: string, creating: boolean, submit: string): string =>
    `<b>${heading}</b><br><br><form method="post"${action === undefined ? '' : ` action="${esc(action)}"`}>${kept}${creating ? '<input type="hidden" name="creating" value="t">' : ''}<table><tr><td><label for="acct${creating ? '-new' : ''}">username:</label></td><td><input type="text" id="acct${creating ? '-new' : ''}" name="acct" size="20" autocomplete="username"></td></tr><tr><td><label for="pw${creating ? '-new' : ''}">password:</label></td><td><input type="password" id="pw${creating ? '-new' : ''}" name="pw" size="20" autocomplete="${creating ? 'new-password' : 'current-password'}"></td></tr></table><br><input type="submit" value="${submit}"></form>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Login</title><style>${HN_CSS}</style></head><body><div class="hn-body">${message ? `<p class="hn-message">${esc(message)}</p>` : ''}${form('Login', false, 'login')}<br><br>${form('Create Account', true, 'create account')}</div></body></html>`;
  return new Response(placedHtml(html, placeOf(ctx)), { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

/** The submit page as a handler answers it: after a sign-in from its login forms, or again with the person's title, url
 *  and text kept under what went wrong. */
export async function submitAgain(ctx: HandlerContext, user: string, message: string, values: { title: string; url: string; text: string } = { title: '', url: '', text: '' }): Promise<Response> {
  const fnid = await submitFnid(ctx, user);
  return sitePage(ctx, 'Submit | Hacker News', `${message ? `<p class="hn-message">${esc(message)}</p>` : ''}<form method="post" action="r"><input type="hidden" name="fnid" value="${esc(fnid)}"><input type="hidden" name="fnop" value="submit-page"><table><tr><td><label for="title">title</label></td><td><input type="text" id="title" name="title" size="50" value="${esc(values.title)}"></td></tr><tr><td><label for="url">url</label></td><td><input type="url" id="url" name="url" size="50" value="${esc(values.url)}"></td></tr><tr><td><label for="text">text</label></td><td><textarea id="text" name="text" rows="4" cols="49">${esc(values.text)}</textarea></td></tr><tr><td></td><td><input type="submit" value="submit"></td></tr></table></form>`, user);
}

/** The add comment page: the item replied to and its form, the person's text kept in it, its button reply under a
 *  comment and add comment under a story. */
// source: https://raw.githubusercontent.com/arclanguage/anarki/622704867effa642c99ecf6aefc6a5f5f698650a/news.arc "(submit (if (acomment parent) \"reply\" \"add comment\"))"
export async function addCommentPage(ctx: HandlerContext, user: string, parent: Row, goto: string, text: string, message = ''): Promise<Response> {
  const hmac = await commentHmac(ctx, user, String(parent.id));
  const said = parent.type === 'story' ? `<a href="item?id=${esc(parent.id)}">${esc(parent.title)}</a>` : `<div>${String(parent.text ?? '')}</div>`;
  return sitePage(ctx, 'Add Comment | Hacker News', `${message ? `<p class="hn-message">${esc(message)}</p>` : ''}<div class="hn-comment">${said}</div><form method="post" action="comment"><input type="hidden" name="parent" value="${esc(parent.id)}"><input type="hidden" name="goto" value="${esc(goto)}"><input type="hidden" name="hmac" value="${esc(hmac)}"><textarea name="text" rows="8" cols="80">${esc(text)}</textarea><br><br><input type="submit" value="${parent.type === 'comment' ? 'reply' : 'add comment'}"></form>`, user);
}

/** A sign-in from a login form (acct, pw), or a new account from a create-account form (creating=t): the person signed
 *  in, `then` done as them, and on to `goto`; or the same page again with what went wrong. */
export async function signIn(ctx: HandlerContext, goto: string, then?: (user: string) => Promise<void>, opts: { carried?: Record<string, string>; answer?: (user: string) => Promise<Response> } = {}): Promise<Response> {
  const acct = String(ctx.params.acct ?? '');
  const pw = String(ctx.params.pw ?? '');
  let user: string | undefined;
  if (ctx.params.creating === 't') {
    const refused = accountRefusal(ctx, acct, pw);
    if (refused) return loginPage(ctx, refused, undefined, opts.carried);
    if (!await makeAccount(ctx, acct, pw)) return loginPage(ctx, usernameTaken(), undefined, opts.carried);
    user = acct;
  } else {
    user = accountWith(ctx, acct, pw);
    // source: https://raw.githubusercontent.com/arclanguage/anarki/622704867effa642c99ecf6aefc6a5f5f698650a/app.arc "(failed-login switch \"Bad login.\" afterward)"
    if (!user) return loginPage(ctx, 'Bad login.', undefined, opts.carried);
  }
  if (then) await then(user);
  if (!opts.answer) return beginSession(ctx, user, goto);
  // signed in, the page the sign-in answers with (a comment's add comment page), with the sign-in's cookie
  const page = await opts.answer(user);
  const headers = new Headers(page.headers);
  headers.append('set-cookie', await sessionCookie(ctx, user));
  return new Response(page.body, { status: page.status, headers });
}
