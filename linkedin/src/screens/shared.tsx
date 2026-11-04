// What linkedin.com's pages share (docs/contributing/architecture.md, "Screens"): its look, who is signed in (the
// `li_at` session cookie, @volter/world-ui's session kit), the global navigation, a post as LinkedIn draws it (its
// author, its little text, its image, video or link card), and how a page reached at a World's place names its links
// and media on the twin's own base. Authored from LinkedIn's documented flow and its pages' structure under LinkedIn's
// colours; nothing of LinkedIn's pages is copied.
import { twinVendorUrl, type HandlerContext } from '@volter/world-core';
import { flowPage, signedIn } from '@volter/world-ui';
import { ACL, audiencesFor, IMAGE, MEMBER, mediaSigner, ORGANIZATION, POST, POSTING_ROLES, urnOf, VIDEO, type Row } from '../semantics/shared.ts';

/** What a page is made of: the element a flow page renders. */
export type Body = Parameters<typeof flowPage>[0]['body'];

export const COOKIE = 'li_at';

/** The member signed in at linkedin.com, or undefined. */
export function memberOf(ctx: HandlerContext): Row | undefined {
  const person = signedIn(ctx, COOKIE);
  return person ? ctx.row(MEMBER, String(person.sub)) : undefined;
}

// Where a visitor is sent, as linkedin.com answers a signed-out GET (read 2026-10-03; no LinkedIn page documents it):
// a member's page (the feed, a page's Posts tab, the sign-out) answers 302 to /uas/login with the page's whole address
// as `session_redirect`; a post's page the visitor may not see, or that is gone, answers 307 to /signup/cold-join with
// the post's address (its dots escaped, no trailing slash). Off a World's place the location is linkedin.com's own
// whole address; at a place, the twin's base path.

/** linkedin.com's whole address of the page a request asked for. */
const askedFor = (ctx: HandlerContext): string => { const url = new URL(ctx.call.request.url); return `https://www.linkedin.com${url.pathname}${url.search}`; };

/** A redirect to a path of linkedin.com with its status: its whole address off a World's place, on the base at one. */
function sendTo(ctx: HandlerContext, location: string, status: number): Response {
  const base = placeOf(ctx);
  return new Response(null, { status, headers: { location: base !== undefined ? `${base}${location}` : `https://www.linkedin.com${location}` } });
}

/** A visitor nobody signed in, sent to the sign-in, which returns them here. */
export function toSignIn(ctx: HandlerContext): Response {
  return sendTo(ctx, `/uas/login?session_redirect=${encodeURIComponent(askedFor(ctx))}`, 302);
}

/** A visitor at a post they may not see, or that is gone: sent to join LinkedIn, which would return them to it. */
export function toJoin(ctx: HandlerContext): Response {
  const post = askedFor(ctx).replace(/\/$/, '');
  return sendTo(ctx, `/signup/cold-join?session_redirect=${encodeURIComponent(post).replace(/\./g, '%2E')}`, 307);
}

// ── where a page was reached ──
// Reached at a World's place (a served or hosted World's /<org>/<world>/linkedin/…, its pages origin), a page of
// linkedin.com is written onto the twin's own base, by path: its links, forms and redirects stay on the origin that
// served it, and its media on LinkedIn's media hosts are named `<base>/@<host>/…`, which the kernel answers as routed
// from that host (twin-world's architecture, "A page at a World's place"). A place whose prefix is `/` has an empty base
// path, and is a place still.

/** The twin's base path at a World's place ('' for a prefix of `/`), or undefined on LinkedIn's own hosts. */
function placeOf(ctx: HandlerContext): string | undefined {
  return ctx.call.request.headers.has('x-forwarded-prefix') ? new URL(ctx.publicBase).pathname.replace(/\/+$/, '') : undefined;
}

/** A page's HTML for a World's place: its root-relative links and forms on the twin's base, linkedin.com's own links
 *  too, and its media on LinkedIn's media hosts at `<base>/@<host>/…`. */
function placed(html: string, base: string | undefined): string {
  if (base === undefined) return html;
  return html
    .replace(/(href|action)="\/(?!\/)/g, `$1="${base}/`)
    .replace(/(src|poster|href)="https:\/\/((?:media|dms)\.licdn\.com)\//g, `$1="${base}/@$2/`)
    .replace(/href="https?:\/\/(?:www\.)?linkedin\.com(?::443)?(?=[/"?#])\/?/gi, `href="${base}/`);
}

/** A redirect to a path of linkedin.com, on the twin's base where the page was reached at a World's place. */
export function seeOther(ctx: HandlerContext, location: string, headers: Record<string, string> = {}): Response {
  const base = placeOf(ctx);
  return new Response(null, { status: 303, headers: { location: base !== undefined && location.startsWith('/') ? `${base}${location}` : location, ...headers } });
}

/** A linkedin.com page. */
export async function page(ctx: HandlerContext, title: string, body: Body, status = 200, css: string[] = [], headers: Record<string, string> = {}): Promise<Response> {
  const res = flowPage({ title: /LinkedIn/.test(title) ? title : `${title} | LinkedIn`, css: [...css, LINKEDIN_CSS], body: <>{body}</>, status });
  return new Response(placed(await res.text(), placeOf(ctx)), { status, headers: { 'content-type': 'text/html; charset=utf-8', ...headers } });
}

/** A page's Refresh while a post on it is processing, so the person sees it posted. Where the documentation stops:
 *  linkedin.com's pages update themselves by their script; the twin's pages carry none, so they reload every five
 *  seconds until no post they show is waiting on its media. */
export function whileProcessing(posts: Row[]): Record<string, string> {
  return posts.some((p) => p.lifecycleState === 'PUBLISH_REQUESTED') ? { refresh: '5' } : {};
}


/** What hands a viewer a media URL: ../semantics/shared.ts mediaSigner, made once per page and given to each post it
 *  draws, which signs only the URLs of the assets of a post the viewer may see (postsBy, visibleTo). */
type Signer = Awaited<ReturnType<typeof mediaSigner>>;

// LinkedIn's palette: its blue, the warm grey of its canvas, white cards and its type stack. Where the documentation
// stops: the measures are the twin's.
const LINKEDIN_CSS = `
* { box-sizing: border-box; }
body { margin: 0; background: #f4f2ee; color: rgba(0,0,0,.9); font: 14px/1.42857 -apple-system, system-ui, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; }
a { color: #0a66c2; text-decoration: none; } a:hover { text-decoration: underline; }
.global-nav { background: #fff; border-bottom: 1px solid #e8e8e8; position: sticky; top: 0; z-index: 2; }
.global-nav__content { max-width: 1128px; margin: 0 auto; display: flex; align-items: center; gap: 8px; height: 52px; padding: 0 16px; }
.global-nav__logo { display: flex; color: #0a66c2; }
.global-nav__items { margin-left: auto; display: flex; gap: 4px; align-items: stretch; height: 100%; }
.global-nav__item { display: flex; flex-direction: column; align-items: center; justify-content: center; min-width: 72px; color: rgba(0,0,0,.6); font-size: 12px; }
.global-nav__item.active { color: rgba(0,0,0,.9); box-shadow: inset 0 -2px 0 rgba(0,0,0,.9); }
.global-nav__menu { position: relative; cursor: pointer; } .global-nav__menu summary { list-style: none; display: flex; flex-direction: column; align-items: center; }
.global-nav__dropdown { position: absolute; right: 0; top: 48px; background: #fff; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,.15); padding: 12px 16px; min-width: 200px; font-size: 14px; display: grid; gap: 8px; }
.global-nav__me { width: 24px; height: 24px; border-radius: 50%; background: #0a66c2; color: #fff; font-size: 11px; display: flex; align-items: center; justify-content: center; }
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; border-radius: 24px; padding: 6px 16px; font-weight: 600; font-size: 16px; border: 1px solid #0a66c2; color: #0a66c2; background: #fff; cursor: pointer; font-family: inherit; }
.btn-primary { background: #0a66c2; color: #fff; }
.btn-primary:hover { background: #004182; text-decoration: none; }
.btn-tertiary { border-color: transparent; color: rgba(0,0,0,.6); font-size: 14px; padding: 8px; border-radius: 4px; }
.layout { max-width: 1128px; margin: 24px auto; padding: 0 16px; display: grid; grid-template-columns: 225px minmax(0, 555px) 300px; gap: 24px; align-items: start; }
.layout-wide { grid-template-columns: minmax(0, 1fr) 300px; }
.card { background: #fff; border-radius: 8px; box-shadow: 0 0 0 1px rgba(140,140,140,.2); margin-bottom: 8px; overflow: hidden; }
.card-body { padding: 12px 16px; }
.muted { color: rgba(0,0,0,.6); }
.small { font-size: 12px; }
.avatar { flex: none; display: flex; align-items: center; justify-content: center; color: #fff; font-weight: 600; background: #0a66c2; }
.avatar-member { border-radius: 50%; }
.avatar-org { border-radius: 4px; background: #1d2226; }
.share-box { padding: 12px 16px; }
.share-box__open { display: flex; gap: 8px; align-items: center; }
.share-box__trigger { flex: 1; display: block; border: 1px solid rgba(0,0,0,.3); border-radius: 35px; padding: 12px 16px; color: rgba(0,0,0,.6); font-weight: 600; text-align: left; background: #fff; }
.share-box__trigger:hover { background: rgba(0,0,0,.08); text-decoration: none; }
.share-box__actions { display: flex; justify-content: space-around; margin-top: 8px; }
.share-box__action { color: rgba(0,0,0,.6); font-weight: 600; padding: 10px 8px; border-radius: 4px; }
.share-box__action:hover { background: rgba(0,0,0,.08); text-decoration: none; }
.composer { padding: 16px 24px; }
.composer h2 { font-size: 20px; font-weight: 400; margin: 0 0 12px; }
.composer fieldset { border: 0; padding: 0; margin: 0 0 12px; }
.composer legend { font-weight: 600; margin-bottom: 6px; }
.composer__as { margin-bottom: 12px; display: flex; gap: 12px; align-items: baseline; }
.composer .choice { display: inline-flex; align-items: center; gap: 6px; margin-right: 16px; }
.composer textarea { width: 100%; min-height: 160px; border: 0; resize: vertical; font-size: 18px; line-height: 1.4; font-family: inherit; outline: none; }
.composer__bar { display: flex; align-items: center; gap: 12px; border-top: 1px solid #e8e8e8; padding-top: 12px; margin-top: 8px; }
.composer__bar .spacer { flex: 1; }
.composer select { font: inherit; padding: 4px 8px; border-radius: 4px; }
.alert { padding: 12px 16px; border-radius: 8px; margin-bottom: 8px; }
.alert-error { background: #fbe9e7; color: #b24020; }
.alert-success { background: #e7f3e9; color: #057642; }
.update { background: #fff; border-radius: 8px; box-shadow: 0 0 0 1px rgba(140,140,140,.2); margin-bottom: 8px; }
.update__actor { display: flex; gap: 8px; padding: 12px 16px 0; }
.update__name { font-weight: 600; color: rgba(0,0,0,.9); }
.update__text { padding: 8px 16px; white-space: pre-wrap; overflow-wrap: anywhere; }
.update__media img, .update__media video { display: block; width: 100%; max-height: 720px; object-fit: contain; background: #000; }
.update__notice { margin: 0 16px 8px; padding: 8px 12px; border-radius: 4px; background: #eef3f8; }
.update__article { display: block; border-top: 1px solid #e8e8e8; color: rgba(0,0,0,.9); background: #eef3f8; }
.update__article img { display: block; width: 100%; max-height: 300px; object-fit: cover; }
.update__article-title { padding: 8px 12px 0; font-weight: 600; }
.update__article-source { padding: 0 12px 8px; }
.update__social { display: flex; justify-content: space-around; border-top: 1px solid #e8e8e8; margin: 0 16px; padding: 4px 0; color: rgba(0,0,0,.6); font-weight: 600; }
.update__social span, .update__social button, .update__social a { padding: 10px 8px; background: none; border: 0; font: inherit; color: inherit; cursor: pointer; text-decoration: none; }
.comment-box { margin-top: 8px; padding: 12px 16px; } .comment-box textarea { width: 100%; min-height: 64px; box-sizing: border-box; border: 1px solid #c8c8c8; border-radius: 8px; padding: 8px; font: inherit; }
.toast { margin: 8px 0; padding: 10px 12px; border-radius: 4px; background: #e8e8e8; }
.hashtag, .mention { color: #0a66c2; font-weight: 600; }
.org-top { height: 140px; background: linear-gradient(135deg, #0a66c2, #004182); }
.org-head { padding: 0 24px 16px; }
.org-logo { margin-top: -48px; border: 4px solid #fff; }
.org-name { font-size: 24px; font-weight: 600; margin: 8px 0 0; }
.org-tabs { display: flex; gap: 8px; border-top: 1px solid #e8e8e8; padding: 0 16px; }
.org-tabs a { padding: 14px 8px; color: rgba(0,0,0,.6); font-weight: 600; }
.org-tabs a.active { color: #01754f; box-shadow: inset 0 -2px 0 #01754f; }
.empty { padding: 32px 16px; text-align: center; }
.sign-in { max-width: 400px; margin: 48px auto; background: #fff; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,.15); padding: 24px; }
.sign-in-mark { background: #0a66c2; }
.sign-in-heading { font-size: 32px; font-weight: 600; text-align: left; }
.sign-in-box { border: 0; padding: 0; }
.sign-in-box input[type=text], .sign-in-box input[type=email], .sign-in-box input[type=password] { border-color: rgba(0,0,0,.6); height: 52px; font-size: 16px; }
.sign-in-submit { background: #0a66c2; color: #fff; border: 0; border-radius: 24px; height: 52px; font-size: 16px; font-weight: 600; }
.sign-in-error { border-color: #b24020; color: #b24020; }
`;

const LOGO = (
  <svg viewBox="0 0 34 34" width="34" height="34" aria-label="LinkedIn" role="img"><rect width="34" height="34" rx="4" fill="#0a66c2" /><path fill="#fff" d="M7 13h4v14H7zM9 6.5a2.3 2.3 0 1 1 0 4.6 2.3 2.3 0 0 1 0-4.6M14 13h3.8v1.9h.1c.5-1 1.8-2.1 3.8-2.1 4.1 0 4.8 2.7 4.8 6.1V27h-4v-7.2c0-1.7 0-3.9-2.4-3.9s-2.7 1.8-2.7 3.8V27H14z" /></svg>
);

/** LinkedIn's global navigation: Home and Me (its menu's Sign out) for a member, Sign in for a visitor. */
// (LinkedIn Help, which the manifest's logout screen cites: "Click the Me icon at top of your LinkedIn homepage.. Select Sign out.")
export function GlobalNav({ member, active, next }: { member: Row | undefined; active?: 'home'; next?: string }): Body {
  return (
    <header className="global-nav">
      <nav className="global-nav__content" aria-label="Primary Navigation">
        <a className="global-nav__logo" href="/feed/">{LOGO}</a>
        <div className="global-nav__items">
          {member ? (
            <>
              <a className={`global-nav__item${active === 'home' ? ' active' : ''}`} href="/feed/">Home</a>
              <details className="global-nav__item global-nav__menu">
                <summary aria-label="Me"><span className="global-nav__me" aria-hidden="true">{initials(String(member.name))}</span>Me</summary>
                <div className="global-nav__dropdown"><div className="update__name">{String(member.name)}</div><a href="/m/logout/">Sign out</a></div>
              </details>
            </>
          ) : (
            <>
              <a className="btn btn-tertiary" href={next ? `/login?session_redirect=${encodeURIComponent(next)}` : '/login'}>Sign in</a>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}

/** A name's initials, for a picture LinkedIn draws when there is none. */
const initials = (name: string): string => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => Array.from(w)[0]!.toUpperCase()).join('');

/** A member's or a page's picture: a page's square, a member's circle. */
export function Avatar({ name, kind, size }: { name: string; kind: 'member' | 'org'; size: number }): Body {
  return <span className={`avatar avatar-${kind}`} style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }} aria-hidden="true">{initials(name)}</span>;
}

/** Who a post's author is: a page's name, vanity name and link, or a member's name. */
export function authorOf(ctx: HandlerContext, author: string): { name: string; kind: 'member' | 'org'; href?: string; subtitle?: string } {
  const u = urnOf(author);
  if (u?.type === 'organization') {
    const o = ctx.row(ORGANIZATION, u.id);
    return o ? { name: String(o.localizedName), kind: 'org', href: `/company/${String(o.vanityName)}/`, ...(o._tagline ? { subtitle: String(o._tagline) } : {}) } : { name: 'LinkedIn Member', kind: 'org' };
  }
  const m = u ? ctx.row(MEMBER, u.id) : undefined;
  return m ? { name: String(m.name), kind: 'member', ...(m._headline ? { subtitle: String(m._headline) } : {}) } : { name: 'LinkedIn Member', kind: 'member' };
}

/** The pages a member may post as: those they hold a posting role on. */
export function pagesOf(ctx: HandlerContext, member: Row): Row[] {
  const person = `urn:li:person:${String(member.sub)}`;
  const urns = new Set(ctx.rowsRaw(ACL).filter((a) => a.roleAssignee === person && a.state === 'APPROVED' && POSTING_ROLES.includes(String(a.role))).map((a) => String(a.organization)));
  return ctx.rowsRaw(ORGANIZATION).filter((o) => urns.has(`urn:li:organization:${String(o.id)}`)).sort((a, b) => Number(a.id) - Number(b.id));
}

/** Whether a member may see a post that is not yet published: a member who may post as its author. */
export function mayManage(ctx: HandlerContext, member: Row | undefined, author: string): boolean {
  if (!member) return false;
  if (author === `urn:li:person:${String(member.sub)}`) return true;
  return pagesOf(ctx, member).some((o) => `urn:li:organization:${String(o.id)}` === author);
}

/** Whether a viewer may see a post: a published post by its visibility (PUBLIC to anyone, LOGGED_IN to members,
 *  CONNECTIONS and CONTAINER to those who manage it, as the World holds no member's connections), and one still
 *  publishing or failed to those who manage it. */
export function visibleTo(ctx: HandlerContext, post: Row, member: Row | undefined): boolean {
  const manages = mayManage(ctx, member, String(post.author));
  return post.lifecycleState === 'PUBLISHED' ? post.visibility === 'PUBLIC' || (post.visibility === 'LOGGED_IN' && member !== undefined) || manages : manages;
}

/** A post's time as the feed shows it: "now", "5m", "3h", "2d", "1w", "4mo", "1yr". */
function ago(nowMs: number, thenMs: number): string {
  const s = Math.max(0, Math.floor((nowMs - thenMs) / 1000));
  const unit = AGO.find(([below]) => s < below) ?? AGO[AGO.length - 1]!;
  return unit[1] === 'now' ? 'now' : `${Math.floor(s / unit[2])}${unit[1]}`;
}
const AGO: Array<[number, string, number]> = [[60, 'now', 1], [3600, 'm', 60], [86_400, 'h', 3600], [604_800, 'd', 86_400], [2_592_000, 'w', 604_800], [31_536_000, 'mo', 2_592_000], [Infinity, 'yr', 31_536_000]];

/** Little text as a page draws it: escapes undone, hashtags (a template's or a `#word`) and mentions in LinkedIn's
 *  link colour (the World serves no hashtag or profile page for them to open), web addresses as links, line breaks
 *  kept. */
function LittleText({ text }: { text: string }): Body {
  const out: Array<Body | string> = [];
  let plain = '';
  const flush = (): void => { if (plain) { out.push(...linkified(plain, out.length)); plain = ''; } };
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
    if (c === '\\' && i + 1 < text.length) { plain += text[i + 1]!; i += 1; continue; }
    const template = text.startsWith('{hashtag|', i) ? /^\{hashtag\|\\?[#＃]\|([^}]*)\}/.exec(text.slice(i)) : null;
    if (template) { flush(); out.push(<span key={out.length} className="hashtag">{`#${template[1]}`}</span>); i += template[0].length - 1; continue; }
    const hashtag = c === '#' && (i === 0 || /\s/.test(text[i - 1]!)) ? /^#([\p{L}\p{N}_]+)/u.exec(text.slice(i)) : null;
    if (hashtag) { flush(); out.push(<span key={out.length} className="hashtag">{`#${hashtag[1]}`}</span>); i += hashtag[0].length - 1; continue; }
    const mention = c === '@' ? /^@\[([^\]]*)\]\(urn:li:[A-Za-z]+:[^)]+\)/.exec(text.slice(i)) : null;
    if (mention) { flush(); out.push(<span key={out.length} className="mention">{mention[1]}</span>); i += mention[0].length - 1; continue; }
    plain += c;
  }
  flush();
  return <>{out}</>;
}

/** Plain text with its web addresses as links, as LinkedIn draws them. */
function linkified(text: string, from: number): Array<Body | string> {
  const parts = text.split(/(https?:\/\/[^\s]+)/g);
  return parts.map((p, i) => (/^https?:\/\//.test(p) ? <a key={`${from}-${i}`} href={p.replace(/[.,;:)]+$/, '')} rel="noopener noreferrer" target="_blank">{p}</a> : p));
}

/** A post as LinkedIn draws it in a feed and on its own page. */
export function Update({ ctx, post, member, now, sign }: { ctx: HandlerContext; post: Row; member: Row | undefined; now: number; sign: Signer }): Body {
  const urn = String(ctx.own(post).id);
  const who = authorOf(ctx, String(post.author));
  const content = (post.content ?? {}) as Row;
  const media = content.media as Row | undefined;
  const article = content.article as Row | undefined;
  const mediaUrn = urnOf(media?.id);
  const asset = mediaUrn ? ctx.row(mediaUrn.type === 'video' ? VIDEO : IMAGE, mediaUrn.id) : undefined;
  const thumb = article?.thumbnail ? ctx.row(IMAGE, urnOf(article.thumbnail)?.id ?? '') : undefined;
  const when = Number(post.publishedAt ?? post.createdAt);
  const name = who.href ? <a className="update__name" href={who.href}>{who.name}</a> : <span className="update__name">{who.name}</span>;
  return (
    <article className="update" data-urn={urn} aria-label={`Post by ${who.name}`}>
      <div className="update__actor">
        <Avatar name={who.name} kind={who.kind} size={48} />
        <div>
          <div>{name}</div>
          {who.subtitle ? <div className="muted small">{who.subtitle}</div> : null}
          <div className="muted small"><a className="muted" href={`/feed/update/${urn}/`}>{ago(now, when)}</a> • {audienceLabel(String(post.visibility))}</div>
        </div>
      </div>
      {String(post.commentary ?? '') ? <div className="update__text"><LittleText text={String(post.commentary)} /></div> : null}
      {post.lifecycleState === 'PUBLISH_REQUESTED' ? <div className="update__notice" role="status">Your {mediaUrn?.type === 'video' ? 'video' : 'image'} is being processed. It will be posted once it is ready.</div> : null}
      {post.lifecycleState === 'PUBLISH_FAILED' ? <div className="update__notice" role="status">Your post couldn't be published: its media failed to process.</div> : null}
      {asset && asset.status === 'AVAILABLE' && mediaUrn?.type === 'image'
        ? <div className="update__media"><img src={twinVendorUrl(ctx.call.request, sign(String(asset.downloadUrl)).url)} alt={String(media?.altText ?? '')} /></div> : null}
      {asset && asset.status === 'AVAILABLE' && mediaUrn?.type === 'video'
        ? <div className="update__media"><video controls preload="metadata" playsInline {...(asset.thumbnail ? { poster: twinVendorUrl(ctx.call.request, sign(String(asset.thumbnail)).url) } : {})} src={twinVendorUrl(ctx.call.request, sign(String(asset.downloadUrl)).url)} aria-label={String(media?.title ?? 'Video')} /></div> : null}
      {article ? (
        <a className="update__article" {...(/^https?:\/\//i.test(String(article.source)) ? { href: String(article.source) } : {})} rel="noopener noreferrer" target="_blank">
          {thumb && thumb.status === 'AVAILABLE' ? <img src={twinVendorUrl(ctx.call.request, sign(String(thumb.downloadUrl)).url)} alt={String(article.thumbnailAltText ?? '')} /> : null}
          <div className="update__article-title">{String(article.title ?? article.source)}</div>
          <div className="update__article-source muted small">{hostOf(String(article.source))}</div>
        </a>
      ) : null}
      {member ? <Social urn={urn} /> : <div className="update__social" aria-hidden="true"><span>Like</span><span>Comment</span><span>Repost</span><span>Send</span></div>}
    </article>
  );
}

/** The social row a signed-in member acts from, by the words LinkedIn draws: Comment opens the post's comment box on its
 *  own page; Like, Repost and Send post the page's form (./post.tsx), each an act on the post the written spec does not
 *  carry, so it answers the gap. Volter Browsers' frontline presses Comment and refuses the rest (volter-ai/lucarne
 *  83c544c packages/lucarne-sites/src/policy.ts:20-22). Where the documentation stops: the accessible names are LinkedIn's
 *  visible words; its own markup was not read (reading it needs an account). */
function Social({ urn }: { urn: string }): Body {
  return (
    <form method="post" action={`/feed/update/${urn}/`} className="update__social">
      <button type="submit" name="intent" value="like" aria-label="Like">Like</button>
      <a href={`/feed/update/${urn}/?commentBox=open`} aria-label="Comment">Comment</a>
      <button type="submit" name="intent" value="repost" aria-label="Repost">Repost</button>
      <button type="submit" name="intent" value="send" aria-label="Send">Send</button>
    </form>
  );
}

/** A post's comment box, opened by Comment: the member's text and its Comment button, which posts the page's form. */
export function CommentBox({ urn, notice }: { urn: string; notice?: string }): Body {
  return (
    <section className="card comment-box">
      {notice ? <div className="toast" role="status">{notice}</div> : null}
      <form method="post" action={`/feed/update/${urn}/`}>
        <textarea name="comment" aria-label="Add a comment" placeholder="Add a comment…"></textarea>
        <button type="submit" className="btn" name="intent" value="comment">Comment</button>
      </form>
    </section>
  );
}

/** Who can see a post, in the share box's words for its choice (../semantics/shared.ts audiencesFor); LinkedIn
 *  members for a post seen by members signed in (LOGGED_IN, the schema's "Viewable by logged in members only"), and its
 *  group's members for one whose container decides (CONTAINER). */
const audienceLabel = (visibility: string): string => audiencesFor('urn:li:person:').find(([v]) => v === visibility)?.[1]
  ?? (visibility === 'CONTAINER' ? 'Its group’s members' : 'LinkedIn members');

const hostOf = (url: string): string => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };

/** The posts a feed or a page lists, newest first: live, and visible to the viewer. */
export function postsBy(ctx: HandlerContext, authors: Set<string>, member: Row | undefined): Row[] {
  // a post distributed to no feed (a dark post: "content that doesn't appear as organic content on a LinkedIn company
  // page", the Posts API page) is on its own page only
  return ctx.rowsRaw(POST).filter((p) => authors.has(String(p.author)) && (p.distribution as Row | undefined)?.feedDistribution !== 'NONE' && visibleTo(ctx, p, member))
    .sort((a, b) => Number(b.createdAt) - Number(a.createdAt) || Number(BigInt(String(b.id)) - BigInt(String(a.id))));
}

/** A form's field (a urlencoded body's, or a query's). */
export function field(ctx: HandlerContext, name: string): string {
  const fromBody = new URLSearchParams(ctx.text).get(name);
  return fromBody ?? new URL(ctx.call.request.url).searchParams.get(name) ?? '';
}

/** The page LinkedIn shows for what it cannot display: a post deleted or not the viewer's to see, a page that does not
 *  exist. */
export function cannotDisplay(ctx: HandlerContext, member: Row | undefined, title: string, line: string): Promise<Response> {
  return page(ctx, title, (
    <>
      <GlobalNav member={member} />
      <main className="layout layout-wide"><section className="card empty"><h1>{line}</h1><a className="btn" href="/feed/">Go to your feed</a></section></main>
    </>
  ), 404);
}

/** A page's return address: a path on linkedin.com (written as a path, or as linkedin.com's whole address, as its own
 *  redirects write `session_redirect`), never another site (`//host` and `/\\host` are another site's to a browser,
 *  which reads a backslash as a slash). */
export function redirectOf(raw: string): string {
  const path = raw.replace(/^https:\/\/(?:www\.)?linkedin\.com(?=\/)/, '');
  const onSite = (p: string): boolean => /^\/(?![\/\\])/.test(p) && !/[\\\s]/.test(p);
  if (!onSite(path)) return '/feed/';
  // its dot segments resolved, so `/feed/../../x` cannot climb above the twin's base at a World's place, and held to the
  // same rule again, so `/x/..//host` cannot resolve to another site
  const resolved = new URL(path, 'https://www.linkedin.com');
  const out = `${resolved.pathname}${resolved.search}`;
  return onSite(out) ? out : '/feed/';
}
