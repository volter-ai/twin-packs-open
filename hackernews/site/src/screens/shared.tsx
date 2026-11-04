// What the site's pages share (architecture, "Pack layout": screens/shared.tsx): Hacker News's look over
// @volter/world-ui's page and session pieces, who is signed in (the `user` cookie, read by world-ui's session kit), the
// World's instant, a story's row and a comment's. Authored from the site as a person sees it: the controls and short
// messages carry the site's own words (so a test finds a control by its name), and no page's markup, assets or prose is
// copied. Every link and form is relative, as the site's own are, so a page reached at a World's place stays there; the
// deliberate departures are the vendor's own outbound links (a story's url, a link typed in a comment) and the show
// page's links to Hacker News's static rules and tips pages, which no World holds (./show.tsx).
import type { HandlerContext } from '@volter/world-core';
import { flowPage, SIGN_IN_CSS, signedIn } from '@volter/world-ui';
import { COOKIE, HN_CSS, hasVoted, logoutLink, placedHtml, placeOf, unixOf, userOf, voteAuth, type Row } from '../semantics/shared.ts';

/** What a page's body is: what world-ui's page renders. */
type ReactNode = Parameters<typeof flowPage>[0]['body'];

/** The username signed in on this request, or undefined. */
export function who(ctx: HandlerContext): string | undefined {
  const person = signedIn(ctx, COOKIE);
  return person ? String(person.acct) : undefined;
}
/** The World's instant, as Hacker News counts time. */
export const nowOf = (ctx: HandlerContext): number => unixOf(ctx.occurredAt);
/** A query parameter of the page's address. */
export const query = (ctx: HandlerContext, name: string): string => new URL(ctx.call.request.url).searchParams.get(name) ?? '';

/** An age as the site writes it beside a post: 5 minutes ago, 1 hour ago, 3 days ago. */
export function age(time: unknown, now: number): string {
  const minutes = Math.floor(Math.max(0, now - Number(time)) / 60);
  const [n, unit] = minutes < 60 ? [minutes, 'minute'] : minutes < 1440 ? [Math.floor(minutes / 60), 'hour'] : [Math.floor(minutes / 1440), 'day'];
  return `${n} ${unit}${n === 1 ? '' : 's'} ago`;
}
/** The instant itself, as the age's title holds it. */
const instant = (time: unknown): string => new Date(Number(time) * 1000).toISOString().slice(0, 19);
/** The site a story links to, as the site names it beside the title. */
export function siteOf(url: unknown): string {
  try { return new URL(String(url)).hostname.replace(/^www\./, ''); } catch { return ''; }
}

const SKIN = `${SIGN_IN_CSS}
.sign-in { max-width: none; margin: 0; padding: 0 0 16px; }
.sign-in-mark { display: none; }
.sign-in-heading { text-align: left; font-weight: bold; font-size: 10pt; margin: 0 0 8px; }
.sign-in-box { border: 0; padding: 0; align-items: flex-start; gap: 2px; }
.sign-in-box input[type=text], .sign-in-box input[type=password] { border: 1px solid #767676; border-radius: 0; padding: 1px 2px; margin-bottom: 4px; font-family: inherit; }
.sign-in-submit { border-radius: 0; padding: 1px 6px; background: #efefef; border-color: #767676; font-weight: normal; font-family: inherit; }
`;

/** A page of the site: the orange bar (the person signed in and their karma, or login) and the page's body, its links
 *  and forms on the base the page was reached at (../semantics/shared.ts placedHtml). */
export async function page(ctx: HandlerContext, title: string, body: ReactNode, status = 200): Promise<Response> {
  const user = who(ctx);
  const karma = user ? userOf(ctx, user)?.karma : undefined;
  // signed in, the bar names the person, their karma and the logout link (../semantics/shared.ts logoutLink)
  const logout = user ? await logoutLink(ctx, user, gotoHere(ctx)) : '';
  const top = (
    <div className="hn-top">
      <a className="hn-logo" href="news">Y</a>
      <b className="hn-name"><a href="news">Hacker News</a></b>
      <a href="newest">new</a>&nbsp;|&nbsp;<a href="show">show</a>&nbsp;|&nbsp;<a href="submit">submit</a>
      <span className="hn-right">{user ? <><a href={`user?id=${user}`}>{user}</a>&nbsp;({String(karma ?? 1)})&nbsp;|&nbsp;<a href={logout}>logout</a></> : <a href={`login?goto=${encodeURIComponent(gotoHere(ctx))}`}>login</a>}</span>
    </div>
  );
  const drawn = flowPage({ title, css: [HN_CSS, SKIN], body: <div className="hn">{top}<div className="hn-body">{body}</div></div>, status });
  return new Response(placedHtml(await drawn.text(), placeOf(ctx)), { status, headers: drawn.headers });
}

/** This page's address as a goto: its path (without the slash) and query. */
export function gotoHere(ctx: HandlerContext): string {
  const url = new URL(ctx.call.request.url);
  // the login page's own login link returns where the page does
  if (url.pathname.replace(/\/+$/, '') === '/login') return url.searchParams.get('goto') || 'news';
  return `${url.pathname.replace(/^\/+/, '') || 'news'}${url.search}`;
}

/** The site's plain answer for what it does not have ("No such item.", "Unknown."). */
export const plain = (text: string, status = 200): Response => new Response(text, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
// each answer in a function of its own, so one no step draws is measured as not drawn
/** news.ycombinator.com/item?id=999999999999 answers "No such item." as text (read 2026-10-02). */
export function noSuchItemPage(): Response {
  return plain('No such item.');
}
/** news.ycombinator.com/user?id=nosuchuserzzq9 answers "No such user." as text (read 2026-10-02). */
export function noSuchUserPage(): Response {
  return plain('No such user.');
}
/** news.ycombinator.com/nosuchpagezz answers "Unknown." as text, 404 (read 2026-10-02). */
export function unknownPage(): Response {
  return plain('Unknown.', 404);
}

/** The login and create-account forms under a message (acct and pw; the create-account form's creating=t), on a bare
 *  page as the site draws them (no top bar). The forms carry no action, as the site's do: each posts to the address the
 *  page is at (news.ycombinator.com/login, /submit, /vote and /reply, read 2026-10-03: `<form method="post">`). Drawn
 *  here rather than with world-ui's SignIn, which always writes an action. */
export async function loginForms(ctx: HandlerContext, title: string, message?: string): Promise<Response> {
  const form = (heading: string, creating: boolean, submit: string) => {
    const suffix = creating ? '-new' : '';
    return (
      <div className="sign-in">
        <h1 className="sign-in-heading">{heading}</h1>
        <form method="post" className="sign-in-box">
          {creating ? <input type="hidden" name="creating" value="t" /> : null}
          <label htmlFor={`acct${suffix}`}>username:</label>
          <input id={`acct${suffix}`} name="acct" type="text" autoComplete="username" />
          <label htmlFor={`pw${suffix}`}>password:</label>
          <input id={`pw${suffix}`} name="pw" type="password" autoComplete={creating ? 'new-password' : 'current-password'} />
          <button type="submit" className="sign-in-submit">{submit}</button>
        </form>
      </div>
    );
  };
  const drawn = flowPage({ title, css: [HN_CSS, SKIN], body: (
    <div className="hn-body">
      {message ? <p className="hn-message">{message}</p> : null}
      {form('Login', false, 'login')}
      {form('Create Account', true, 'create account')}
    </div>
  ) });
  return new Response(placedHtml(await drawn.text(), placeOf(ctx)), { status: 200, headers: drawn.headers });
}

/** The vote link's auth for each post the person may upvote: not their own, not voted on yet. */
export async function voteLinks(ctx: HandlerContext, user: string | undefined, posts: Row[]): Promise<Map<number, string>> {
  const links = new Map<number, string>();
  for (const p of posts) {
    if (user && (p.by === user || hasVoted(ctx, user, String(p.id)))) continue;
    links.set(Number(p.id), user ? await voteAuth(ctx, user, String(p.id)) : '');
  }
  return links;
}

/** The arrow beside a post: its vote link, an asterisk on the person's own, nothing once voted. */
// newsfaq.html: "Why do I see an orange/red asterisk? It just means it's your own post."
export function Arrow(props: { post: Row; user: string | undefined; links: Map<number, string>; goto: string }) {
  const id = Number(props.post.id);
  if (props.user && props.post.by === props.user) return <span className="hn-arrow" style={{ color: '#ff6600' }}>*</span>;
  if (!props.links.has(id)) return <span className="hn-arrow" />;
  const auth = props.links.get(id);
  return <a className="hn-arrow" id={`up_${id}`} aria-label="upvote" title="upvote" href={`vote?id=${id}&how=up${auth ? `&auth=${auth}` : ''}&goto=${encodeURIComponent(props.goto)}`}>▲</a>;
}

/** A story's line under its title: points, who, when, and its comments. */
export function Subtext(props: { story: Row; now: number }) {
  const s = props.story;
  const n = Number(s.descendants ?? 0);
  return (
    <span className="hn-sub">
      <span className="score" id={`score_${String(s.id)}`}>{String(s.score ?? 1)} point{Number(s.score ?? 1) === 1 ? '' : 's'}</span> by <a href={`user?id=${String(s.by)}`}>{String(s.by)}</a>{' '}
      <span className="age" title={instant(s.time)}><a href={`item?id=${String(s.id)}`}>{age(s.time, props.now)}</a></span> | <a href={`item?id=${String(s.id)}`}>{n === 0 ? 'discuss' : `${n} comment${n === 1 ? '' : 's'}`}</a>
    </span>
  );
}

/** A story's title: its link (or its own page, for a text post) and the site it links to. */
export function Title(props: { story: Row }) {
  const s = props.story;
  return (
    <span className="hn-title">
      <a href={s.url ? String(s.url) : `item?id=${String(s.id)}`}>{String(s.title ?? '')}</a>
      {s.url ? <span className="hn-site"> (<span>{siteOf(s.url)}</span>)</span> : null}
    </span>
  );
}

/** A list of stories, ranked from `start`, as the front page, newest and show draw them. */
export async function storyList(ctx: HandlerContext, title: string, stories: Row[], goto: string, note?: ReactNode): Promise<Response> {
  const user = who(ctx);
  const now = nowOf(ctx);
  const shown = stories.slice(0, 30);
  const links = await voteLinks(ctx, user, shown);
  return page(ctx, title, (
    <>
      {note ? <p className="hn-message">{note}</p> : null}
      <table>
        <tbody>
          {shown.flatMap((s, i) => [
            <tr key={`t${String(s.id)}`} id={String(s.id)}>
              <td className="hn-rank">{i + 1}.</td>
              <td className="hn-arrow"><Arrow post={s} user={user} links={links} goto={goto} /></td>
              <td><Title story={s} /></td>
            </tr>,
            <tr key={`s${String(s.id)}`}><td colSpan={2} /><td><Subtext story={s} now={now} /></td></tr>,
            <tr key={`g${String(s.id)}`} style={{ height: '5px' }} />,
          ])}
        </tbody>
      </table>
    </>
  ));
}

/** A comment and the comments under it, in the ranked order its kids hold. */
export function Thread(props: { comment: Row; depth: number; story: Row; user: string | undefined; links: Map<number, string>; now: number; read: (id: unknown) => Row | undefined }) {
  const c = props.comment;
  const goto = `item?id=${String(props.story.id)}`;
  return (
    <>
      <div className="hn-comment" id={String(c.id)} style={{ marginLeft: `${props.depth * 40}px` }}>
        <Arrow post={c} user={props.user} links={props.links} goto={goto} />{' '}
        <span className="hn-sub"><a href={`user?id=${String(c.by)}`}>{String(c.by)}</a> <span className="age" title={instant(c.time)}><a href={`item?id=${String(c.id)}`}>{age(c.time, props.now)}</a></span></span>
        <div className="hn-text" dangerouslySetInnerHTML={{ __html: String(c.text ?? '') }} />
        <a className="hn-reply" href={`reply?id=${String(c.id)}&goto=${encodeURIComponent(`${goto}#${String(c.id)}`)}`}>reply</a>
      </div>
      {((c.kids as number[] | undefined) ?? []).map((k) => props.read(k)).filter((k): k is Row => Boolean(k)).map((k) => (
        <Thread key={String(k.id)} comment={k} depth={props.depth + 1} story={props.story} user={props.user} links={props.links} now={props.now} read={props.read} />
      ))}
    </>
  );
}

/** Every comment under an item, read as `read` reads one, for the vote links its page draws. */
export function commentsUnder(item: Row, read: (id: unknown) => Row | undefined): Row[] {
  const out: Row[] = [];
  const walk = (i: Row): void => { for (const k of (i.kids as number[] | undefined) ?? []) { const c = read(k); if (c) { out.push(c); walk(c); } } };
  walk(item);
  return out;
}
