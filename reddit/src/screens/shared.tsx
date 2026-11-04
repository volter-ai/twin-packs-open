// What reddit.com's pages share (twin-world's architecture, "Pack layout": screens/shared.tsx): who is signed in (the
// `reddit_session` cookie, world-ui's session kit) and their modhash, the page's shell under Reddit's look, a post as a
// card, and the page script whose every control calls Reddit's own API: /api/vote, /api/subscribe, /api/comment, the
// media lease and its upload, /api/submit. Authored from plain markup under Reddit's colours; nothing of Reddit's pages
// is copied.
//
// A page reached at a World's place (a served or hosted World's /<org>/<world>/reddit/…) writes its links, its forms,
// its API calls and its media onto the twin's base: the media hosts as `<base>/@<host>/…`, which the kernel answers as
// a request from that host.
import { personOf, twinVendorUrl, type HandlerContext } from '@volter/world-core';
import { flowPage, signedIn } from '@volter/world-ui';
import { accountOfPerson, membership, modhashFor, nowSeconds, sessionCookie, SUBREDDIT, subredditNamed, subscribersOf, type Row } from '../semantics/shared.ts';

export const SESSION_COOKIE = 'reddit_session';

/** What a page holds: the markup world-ui's flowPage renders. */
type ReactNode = Parameters<typeof flowPage>[0]['body'];

/** Who is on the page: their account, the session cookie and the modhash their page's calls send back. */
export type Viewer = { account: Row; modhash: string } | undefined;

export async function viewerOf(ctx: HandlerContext): Promise<Viewer> {
  const person = signedIn(ctx, SESSION_COOKIE);
  if (!person || !personOf(ctx, person.email)) return undefined;
  const account = accountOfPerson(ctx, person.email);
  if (!account) return undefined;
  const cookie = sessionCookie(ctx);
  return { account, modhash: await modhashFor(ctx, cookie) };
}

// ── where a page was reached ──
// Reached at a World's place (a served or hosted World's /<org>/<world>/reddit/…, its pages origin), a page of reddit.com
// is written onto the twin's own base, by path: its links, forms, redirects and API calls stay on the origin that served
// it, and its media on Reddit's content hosts are named `<base>/@<host>/…`, which the kernel answers as routed from that
// host (twin-world's architecture, "A page at a World's place"); so is the upload its Create Post posts to the S3 host a
// lease names. A place whose prefix is `/` has an empty base path, and is a place still.

/** The twin's base path at a World's place ('' for a prefix of `/`), or undefined on reddit.com's own host. */
export const baseOf = (ctx: HandlerContext): string | undefined => (ctx.call.request.headers.has('x-forwarded-prefix') ? new URL(ctx.publicBase).pathname.replace(/\/+$/, '') : undefined);

/** A media URL as the page loads it: at a World's place, on the twin's base. */
const mediaUrl = (ctx: HandlerContext, base: string | undefined, url: unknown): string => {
  const u = String(url ?? '');
  return u.replace(/^https:\/\/([a-z0-9.-]+\.(?:redd\.it|redditmedia\.com|amazonaws\.com))\//, (prefix, host: string) => {
    const hosted = twinVendorUrl(ctx.call.request, prefix);
    return hosted !== prefix || base === undefined ? hosted : `${base}/@${host}/`;
  });
};

/** A 302 to a path on the page's own base. */
export const seeOther = (base: string | undefined, path: string, headers: Record<string, string> = {}): Response => new Response(null, { status: 302, headers: { location: `${base ?? ''}${path}`, ...headers } });

/** To the sign-in, which returns the person to the page they asked for (Reddit's `dest`). */
function toLogin(ctx: HandlerContext): Response {
  const base = baseOf(ctx);
  // the request's own path is the page's, the World's place taken off before it reached the twin
  const url = new URL(ctx.call.request.url);
  return seeOther(base, `/login/?dest=${encodeURIComponent(`${url.pathname}${url.search}`)}`);
}

/** "5 min. ago", as reddit.com says a time, from the World's present: the largest unit the time has passed. */
const UNITS: Array<[number, (n: number) => string]> = [
  [31536000, (n) => `${n} yr. ago`], [2592000, (n) => `${n} mo. ago`], [86400, (n) => `${n} day${n === 1 ? '' : 's'} ago`],
  [3600, (n) => `${n} hr. ago`], [60, (n) => `${n} min. ago`],
];
export function ago(now: number, then: number): string {
  const s = Math.max(0, now - then);
  const unit = UNITS.find(([size]) => s >= size);
  return unit ? unit[1](Math.floor(s / unit[0])) : 'just now';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dateOf = (seconds: number): string => { const d = new Date(seconds * 1000); return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`; };

/** A count as reddit.com writes it: 1.2k past a thousand. */
export const count = (n: number): string => (Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : String(n));

// ── the shell ───────────────────────────────────────────────────────────────────────────────────

export const SNOO = (
  <svg viewBox="0 0 20 20" width="32" height="32" aria-hidden="true"><circle cx="10" cy="10" r="10" fill="#FF4500" /><path fill="#fff" d="M16.67 10a1.46 1.46 0 0 0-2.47-1 7.12 7.12 0 0 0-3.85-1.23L11 4.65l2.14.45a1 1 0 1 0 .13-.61L10.82 4a.31.31 0 0 0-.37.24l-.74 3.47a7.14 7.14 0 0 0-3.9 1.23 1.46 1.46 0 1 0-1.61 2.39 2.87 2.87 0 0 0 0 .44c0 2.24 2.61 4.06 5.83 4.06s5.83-1.82 5.83-4.06a2.87 2.87 0 0 0 0-.44 1.46 1.46 0 0 0 .82-1.33zM6.67 11a1 1 0 1 1 1 1 1 1 0 0 1-1-1zm5.81 2.75a3.84 3.84 0 0 1-2.47.77 3.84 3.84 0 0 1-2.47-.77.27.27 0 0 1 .38-.38A3.27 3.27 0 0 0 10 14a3.28 3.28 0 0 0 2.09-.61.28.28 0 1 1 .39.4zm-.18-1.71a1 1 0 1 1 1-1 1 1 0 0 1-1.01 1.04z" /></svg>
);

const WORDMARK = (
  <svg viewBox="0 0 57 18" width="57" height="18" aria-label="reddit" role="img"><text x="0" y="14" fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" fontWeight="700" fontSize="17" fill="#FF4500">reddit</text></svg>
);

/** An account's picture: Reddit's default avatar (a snoo on its colour), as the twin serves no profile photos. */
export const Avatar = ({ size = 32 }: { size?: number }) => (
  <span className="avatar" style={{ width: size, height: size }} aria-hidden="true">
    <svg viewBox="0 0 20 20" width={size} height={size}><circle cx="10" cy="10" r="10" fill="#94E044" /><path fill="#fff" d="M10 5.5c2.9 0 5.2 1.7 5.2 4.2S12.9 14 10 14s-5.2-1.8-5.2-4.3S7.1 5.5 10 5.5z" /><circle cx="8" cy="9.5" r="0.9" fill="#0f1a1c" /><circle cx="12" cy="9.5" r="0.9" fill="#0f1a1c" /></svg>
  </span>
);

export const CommunityIcon = ({ size = 32 }: { size?: number }) => (
  <span className="avatar" style={{ width: size, height: size }} aria-hidden="true">
    <svg viewBox="0 0 20 20" width={size} height={size}><circle cx="10" cy="10" r="10" fill="#0079D3" /><text x="10" y="14" textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff" fontFamily="-apple-system, Helvetica, Arial, sans-serif">r/</text></svg>
  </span>
);

/** reddit.com's top bar: the logo (its front page, `/`), Create (a post), and the person signed in or Log In. */
function Header({ base, viewer, create, here }: { base: string | undefined; viewer: Viewer; create: string; here: string }) {
  return (
    <header className="topbar">
      <a className="logo" href={`${base ?? ''}/`} aria-label="Home">{SNOO}{WORDMARK}</a>
      <div className="spacer" />
      {viewer ? (
        <>
          <a className="btn-plain create" href={`${base ?? ''}${create}`} aria-label="Create post">
            <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true"><path d="M10 3v14M3 10h14" stroke="currentColor" strokeWidth="1.8" fill="none" /></svg>
            <span>Create</span>
          </a>
          <span className="me" title={`u/${String(viewer.account.name)}`}><Avatar size={32} /><span className="me-name">u/{String(viewer.account.name)}</span></span>
        </>
      ) : (
        <a className="btn-primary" href={`${base ?? ''}/login/?dest=${encodeURIComponent(here)}`}>Log In</a>
      )}
    </header>
  );
}

/** A reddit.com page: the top bar, the page, and its script, with who is signed in on the body for the script. */
export function page(ctx: HandlerContext, title: string, viewer: Viewer, main: ReactNode, options: { status?: number; create?: string; rail?: ReactNode } = {}): Response {
  const base = baseOf(ctx);
  const body = (
    <div className="app" data-base={base ?? ''} data-placed={base === undefined ? '' : '1'} data-modhash={viewer?.modhash ?? ''} data-me={viewer ? String(viewer.account.name) : ''}>
      <Header base={base} viewer={viewer} create={options.create ?? '/submit'} here={`${new URL(ctx.call.request.url).pathname}${new URL(ctx.call.request.url).search}`} />
      <div className="layout">
        <main className="main">{main}</main>
        {options.rail ? <aside className="rail">{options.rail}</aside> : null}
      </div>
      <div className="toast" role="status" aria-live="polite" hidden />
      <script dangerouslySetInnerHTML={{ __html: CLIENT_JS }} />
    </div>
  );
  return flowPage({ title, css: [REDDIT_CSS], body, status: options.status ?? 200 });
}

/** reddit.com's page for what is not there. */
export function notFoundPage(ctx: HandlerContext, viewer: Viewer, heading = 'Sorry, nobody on Reddit goes by that name.', line = 'The person may have been banned or the username is incorrect.'): Response {
  return page(ctx, 'reddit.com: page not found', viewer, <section className="empty"><h1>{heading}</h1><p className="muted">{line}</p></section>, { status: 404 });
}

// ── a post ──────────────────────────────────────────────────────────────────────────────────────

/** The vote buttons and score of a thing, as reddit.com draws them; each calls POST /api/vote. */
export function Votes({ fullname, score, likes }: { fullname: string; score: number; likes: unknown }) {
  const dir = likes === true ? 1 : likes === false ? -1 : 0;
  return (
    <span className={`votes${dir === 1 ? ' up' : dir === -1 ? ' down' : ''}`} data-thing={fullname} data-dir={dir} data-score={score - dir}>
      <button type="button" className="vote-up" aria-label="Upvote" aria-pressed={dir === 1} data-vote="1">
        <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M10 3l6 7h-3.5v7h-5v-7H4z" fill="currentColor" /></svg>
      </button>
      <span className="score">{count(score)}</span>
      <button type="button" className="vote-down" aria-label="Downvote" aria-pressed={dir === -1} data-vote="-1">
        <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M10 17l-6-7h3.5V3h5v7H16z" fill="currentColor" /></svg>
      </button>
    </span>
  );
}

/** What a post shows: its video playing, its image or its link card, then its body (a body goes with any kind of post,
 *  as Create Post offers one on every tab); a long body in a listing is left for its page.
 *  source: https://raw.githubusercontent.com/praw-dev/praw/v8.0.3/praw/models/reddit/subreddit/subreddit.py "may accompany any of them"
 *  source: https://raw.githubusercontent.com/praw-dev/praw/v8.0.3/tests/integration/cassettes/TestSubreddit.test_submit_image__selftext.json "text=Testing+%2A%2APRAW%2A%2A+image+submission" */
function PostMedia({ ctx, post, base, full }: { ctx: HandlerContext; post: Row; base: string | undefined; full: boolean }) {
  if (post.removed_by_category === 'deleted') return <p className="removed">Sorry, this post was deleted by the person who originally posted it.</p>;
  const body = post.selftext_html && (full || String(post.selftext).length < 600)
    ? <div className="md-body" dangerouslySetInnerHTML={{ __html: String(post.selftext_html).replace(/<!-- SC_O(?:FF|N) -->/g, '') }} />
    : null;
  return <>{postMedia(ctx, post, base)}{body}</>;
}

function postMedia(ctx: HandlerContext, post: Row, base: string | undefined) {
  const media = post.media as { reddit_video?: Row } | null;
  const preview = (post.preview as { images?: Array<{ source?: Row }> } | undefined)?.images?.[0]?.source;
  if (post.is_video && media?.reddit_video) {
    const v = media.reddit_video;
    return (
      <div className="media media-video">
        <video controls playsInline preload="metadata" src={mediaUrl(ctx, base, v.fallback_url)} poster={preview ? mediaUrl(ctx, base, preview.url) : undefined} aria-label={`Video: ${String(post.title)}`} />
      </div>
    );
  }
  if (post.post_hint === 'image') {
    return <div className="media media-image"><img src={mediaUrl(ctx, base, post.url)} alt={String(post.title)} /></div>;
  }
  if (post.post_hint === 'link') {
    return (
      <a className="link-card" href={String(post.url)} target="_blank" rel="noopener nofollow ugc">
        <span className="link-domain">{String(post.domain)}</span>
        <span className="link-url">{String(post.url)}</span>
        <span className="link-icon" aria-hidden="true"><svg viewBox="0 0 20 20" width="20" height="20"><path d="M8 12l4-4M9 5l1.5-1.5a3.5 3.5 0 0 1 5 5L14 10M11 15l-1.5 1.5a3.5 3.5 0 0 1-5-5L6 10" stroke="currentColor" strokeWidth="1.6" fill="none" /></svg></span>
      </a>
    );
  }
  return null;
}

/** A post as a card in a listing, or as the head of its own comments page. */
export function PostCard({ ctx, post, base, mode, viewer }: { ctx: HandlerContext; post: Row; base: string | undefined; mode: 'listing' | 'page'; viewer: Viewer }) {
  const now = nowSeconds(ctx);
  const deleted = post.removed_by_category === 'deleted';
  const href = `${base ?? ''}${String(post.permalink)}`;
  // a post on a person's profile (Reddit's u_<name> community) names the person, and its place is their page
  const profile = /^u_/i.test(String(post.subreddit)) ? String(post.subreddit).slice(2) : undefined;
  const place = profile ? `/user/${profile}/` : `/r/${String(post.subreddit)}/`;
  const placeName = profile ? `u/${profile}` : `r/${String(post.subreddit)}`;
  return (
    <article className={`post post-${mode}`} data-fullname={String(post.name)} aria-label={String(post.title)}>
      <div className="post-meta">
        {mode === 'page' ? <a className="back" href={`${base ?? ''}${place}`} aria-label="Back">←</a> : null}
        <CommunityIcon size={mode === 'page' ? 32 : 24} />
        <span className="meta-lines">
          <span className="meta-line">
            <a className="community" href={`${base ?? ''}${place}`}>{placeName}</a>
            <span className="dot">•</span>
            <time dateTime={new Date(Number(post.created_utc) * 1000).toISOString()} title={new Date(Number(post.created_utc) * 1000).toUTCString()}>{ago(now, Number(post.created_utc))}</time>
          </span>
          {mode === 'page' ? <span className="author">{deleted ? '[deleted]' : String(post.author)}</span> : <span className="author">u/{deleted ? '[deleted]' : String(post.author)}</span>}
        </span>
      </div>
      {mode === 'page' ? <h1 className="post-title">{String(post.title)}</h1> : <h2 className="post-title"><a href={href}>{String(post.title)}</a></h2>}
      {post.link_flair_text ? <span className="flair">{String(post.link_flair_text)}</span> : null}
      {post.over_18 ? <span className="flair nsfw">NSFW</span> : null}
      {post.spoiler ? <span className="flair spoiler">Spoiler</span> : null}
      <PostMedia ctx={ctx} post={post} base={base} full={mode === 'page'} />
      <div className="actions">
        <Votes fullname={String(post.name)} score={Number(post.score ?? 0)} likes={viewer ? post.likes : null} />
        <a className="pill" href={`${href}`} aria-label={`${String(post.num_comments)} ${Number(post.num_comments) === 1 ? 'comment' : 'comments'}`}>
          <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M3 4h14v9H8l-4 3v-3H3z" stroke="currentColor" strokeWidth="1.5" fill="none" /></svg>
          <span>{count(Number(post.num_comments ?? 0))}</span>
        </a>
        <button type="button" className="pill share" data-share={String(post.permalink)}>
          <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M11 4l6 5-6 5v-3c-4 0-6 1-8 4 1-5 3-8 8-8z" stroke="currentColor" strokeWidth="1.5" fill="none" /></svg>
          <span>Share</span>
        </button>
      </div>
    </article>
  );
}

/** The community's side panel: its about, its members, when it was made. */
export function CommunityRail({ ctx, sr }: { ctx: HandlerContext; sr: Row }) {
  return (
    <section className="rail-card" aria-label={`About r/${String(sr.display_name)}`}>
      <h2>{String(sr.title || `r/${String(sr.display_name)}`)}</h2>
      {sr.public_description ? <p>{String(sr.public_description)}</p> : null}
      <p className="muted">Created {dateOf(Number(sr.created_utc))}</p>
      <p className="muted">{String(sr.subreddit_type) === 'public' ? 'Public' : String(sr.subreddit_type) === 'restricted' ? 'Restricted' : 'Private'}</p>
      <div className="stats"><span><strong>{count(subscribersOf(ctx, String(sr.id)))}</strong> Members</span></div>
    </section>
  );
}

/** The communities a person may post to, as Create Post's picker offers them: those they joined or moderate first, then
 *  every other public community (Reddit's picker searches them all), and their own profile last. */
function postableCommunities(ctx: HandlerContext, viewer: NonNullable<Viewer>): Row[] {
  const id = String(viewer.account.id);
  const rank = (sr: Row): number => {
    if (sr._profile_of === id) return 2;
    const m = membership(ctx, String(sr.id), id);
    return m.subscriber || m.moderator ? 0 : 1;
  };
  const open = ctx.rowsRaw(SUBREDDIT).filter((sr) => sr._profile_of === id || (sr._profile_of === undefined && (sr.subreddit_type === 'public' || membership(ctx, String(sr.id), id).moderator)));
  return open.sort((a, b) => rank(a) - rank(b) || String(a.display_name).localeCompare(String(b.display_name)));
}

// ── the look ────────────────────────────────────────────────────────────────────────────────────

// reddit.com's light theme, its measures and colours as its pages draw them (Reddit's own design tokens are not
// published; these are the twin's, written to its look): exempt from the Volter brand
export const REDDIT_CSS = `
:root{--bg:#fff;--text:#0f1a1c;--muted:#576f76;--line:#e5ebee;--soft:#eaedef;--hover:#f6f8f9;--orange:#ff4500;--blue:#0a449b;--down:#6a5cff}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:20px}
a{color:inherit;text-decoration:none}
button{font:inherit;color:inherit}
.muted{color:var(--muted)}
.topbar{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:8px;height:56px;padding:0 16px;background:#fff;border-bottom:1px solid var(--line)}
.logo{display:flex;align-items:center;gap:8px}
.spacer{flex:1}
.btn-primary{display:inline-flex;align-items:center;height:40px;padding:0 16px;border-radius:999px;background:var(--orange);color:#fff;font-weight:600;border:0;cursor:pointer}
.btn-primary:disabled{opacity:.5;cursor:default}
.btn-blue{display:inline-flex;align-items:center;height:32px;padding:0 14px;border-radius:999px;background:var(--blue);color:#fff;font-weight:600;border:0;cursor:pointer}
.btn-outline{display:inline-flex;align-items:center;gap:4px;height:32px;padding:0 14px;border-radius:999px;background:#fff;border:1px solid #c4ced1;font-weight:600;cursor:pointer}
.btn-plain{display:inline-flex;align-items:center;gap:6px;height:40px;padding:0 12px;border-radius:999px;font-weight:600}
.btn-plain:hover{background:var(--hover)}
.me{display:inline-flex;align-items:center;gap:6px}.me-name{font-size:12px;color:var(--muted)}
.avatar{display:inline-flex;border-radius:50%;overflow:hidden;flex:none}
.layout{display:flex;gap:16px;max-width:1120px;margin:0 auto;padding:16px}
.main{flex:1;min-width:0;max-width:756px}
.rail{width:316px;flex:none}
.rail-card{background:#f6f8f9;border-radius:16px;padding:16px}
@media (max-width:960px){.rail{display:none}}
.rail-card h2{font-size:16px;margin:0 0 8px}.rail-card p{margin:0 0 8px}
.stats{margin-top:12px}
.banner{height:64px;border-radius:8px;background:linear-gradient(90deg,#1a1a1b,#33464c)}
.sr-head{display:flex;align-items:flex-end;gap:12px;margin:-28px 16px 16px}
.sr-head .avatar{border:4px solid #fff}
.sr-head h1{font-size:28px;line-height:36px;margin:0;flex:1}
.all-head{margin:8px 16px 16px}
.sr-actions{display:flex;gap:8px;align-items:center}
.sorts{display:flex;gap:4px;margin:8px 0;border-bottom:1px solid var(--line);padding-bottom:8px}
.sorts a{padding:6px 12px;border-radius:999px;font-weight:600;color:var(--muted)}
.sorts a[aria-current="page"]{background:var(--soft);color:var(--text)}
.post{padding:8px 16px 12px;border-radius:16px}
.post-listing:hover{background:var(--hover)}
.post-listing{border-bottom:1px solid var(--line);border-radius:0}
.post-meta{display:flex;align-items:center;gap:8px;font-size:12px;color:var(--muted)}
.meta-lines{display:flex;flex-direction:column}
.meta-line{display:flex;gap:4px;align-items:center}
.community{font-weight:600;color:var(--text)}
.author{color:var(--muted)}
.back{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:50%;background:var(--soft);font-size:18px}
.post-title{font-size:18px;line-height:24px;margin:8px 0;font-weight:600}
.post-page .post-title{font-size:24px;line-height:30px}
.flair{display:inline-block;font-size:12px;background:var(--soft);border-radius:999px;padding:0 8px;margin-right:6px}
.flair.nsfw{background:#ffd0d0}
.media{margin:8px 0;border-radius:16px;overflow:hidden;background:#000;display:flex;justify-content:center}
.media video,.media img{max-width:100%;max-height:540px;display:block}
.media-image{background:var(--soft)}
.link-card{display:flex;align-items:center;gap:12px;margin:8px 0;padding:12px 16px;border:1px solid var(--line);border-radius:16px}
.link-card:hover{border-color:#c4ced1}
.link-domain{font-weight:600}.link-url{flex:1;color:var(--blue);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.md-body{margin:8px 0}.md-body p{margin:0 0 8px}
.md-body a{color:var(--blue);text-decoration:underline}.md-body a:visited{color:#6c1fa3}.md-body code{font-family:ui-monospace,Menlo,monospace;background:var(--soft);border-radius:4px;padding:0 4px}
.removed{color:var(--muted);font-style:italic}
.actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:8px}
.votes,.pill{display:inline-flex;align-items:center;gap:4px;height:32px;border-radius:999px;background:var(--soft);padding:0 4px;font-weight:600;font-size:12px}
.pill{padding:0 12px;border:0;cursor:pointer}
.votes button{border:0;background:none;width:24px;height:24px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;color:var(--text)}
.votes button:hover{background:#dbe0e3}
.votes.up{background:var(--orange);color:#fff}.votes.up button{color:#fff}
.votes.down{background:var(--down);color:#fff}.votes.down button{color:#fff}
.composer{margin:16px 0;border:1px solid #c4ced1;border-radius:20px;padding:8px 12px}
.composer textarea{width:100%;border:0;resize:vertical;min-height:40px;font:inherit;outline:none}
.composer-row{display:flex;justify-content:flex-end;gap:8px}
.comments{margin-top:8px}
.comment{padding:8px 0 4px 12px;border-left:2px solid var(--line);margin-left:8px}
.comment-meta{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted)}
.comment-meta .who{font-weight:600;color:var(--text)}
.op{color:var(--blue);font-weight:700}
.comment-body p{margin:4px 0}
.comment-actions{display:flex;gap:4px;align-items:center}
.share-panel{flex-basis:100%;margin-top:8px}.share-panel label{display:flex;gap:8px;align-items:center;font-size:12px;color:#576f76}.share-panel input{flex:1;border:1px solid #c4ced1;border-radius:8px;padding:6px 10px;font:inherit;color:#1a1a1b}
.overflow{position:relative}.overflow .menu{position:absolute;left:0;top:28px;z-index:5;background:#fff;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,.2);padding:4px 0;min-width:140px}
.overflow .menu button{display:block;width:100%;text-align:left;border:0;background:none;padding:8px 16px;font:inherit;cursor:pointer}.overflow .menu button:hover{background:#eaedef}
dialog.confirm{border:0;border-radius:16px;padding:24px;max-width:420px}dialog.confirm h2{margin:0 0 8px;font-size:20px}
.comment-actions .votes,.comment-actions .votes.up,.comment-actions .votes.down{background:none;color:var(--text)}
.comment-actions .votes button{color:var(--text)}
.comment-actions .votes.up,.comment-actions .votes.up .vote-up{color:var(--orange)}
.comment-actions .votes.down,.comment-actions .votes.down .vote-down{color:var(--down)}
.reply-btn{border:0;background:none;font-weight:600;font-size:12px;color:var(--muted);cursor:pointer;padding:4px 8px;border-radius:999px}
.reply-btn:hover{background:var(--hover)}
.sort-line{font-size:12px;color:var(--muted)}
.empty{padding:48px 16px;text-align:center}
.submit h1{font-size:24px;margin:8px 0 16px}
.submit .field{display:flex;flex-direction:column;gap:4px;margin-bottom:12px}
[hidden]{display:none!important}
.submit input[type=text],.submit input[type=url],.submit textarea,.submit select{font:inherit;border:1px solid #c4ced1;border-radius:16px;padding:10px 14px;background:#fff}
.submit textarea{min-height:140px;resize:vertical}
.tabs{display:flex;gap:4px;margin-bottom:12px}
.tabs button{border:0;background:none;padding:8px 14px;border-radius:999px;font-weight:600;cursor:pointer;color:var(--muted)}
.tabs button[aria-selected="true"]{background:var(--soft);color:var(--text);box-shadow:inset 0 -3px 0 var(--blue)}
.counter{font-size:12px;color:var(--muted);align-self:flex-end}
.drop{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;border:1px dashed #c4ced1;border-radius:16px;padding:32px;text-align:center}
.drop .chosen{font-weight:600}
.drop.over{border-color:var(--blue);background:#f0f5ff}
.submit-row{display:flex;justify-content:flex-end;gap:8px;margin-top:8px}
.error{color:#d93a00;font-weight:600}
.progress{color:var(--muted);font-size:12px}
.toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#0f1a1c;color:#fff;padding:10px 16px;border-radius:999px;font-weight:600}
`;

// ── the page script ─────────────────────────────────────────────────────────────────────────────

/** What a person's clicks do on reddit.com's pages: each calls Reddit's own API on the page's base, with the session
 *  cookie and the modhash (X-Modhash), and shows its answer. Share's link, where the clipboard is refused, is shown as
 *  Reddit's share panel shows it: a read-only field, selected on a click.
 *  source: https://raw.githubusercontent.com/reddit-archive/reddit/master/r2/r2/public/static/js/post-sharing.js "this.refs.$postSharingLinkInput.focus().select();" */
const CLIENT_JS = `
(function(){
  var app = document.querySelector('.app'); if (!app) return;
  var BASE = app.dataset.base || '', PLACED = app.dataset.placed === '1', MH = app.dataset.modhash || '', ME = app.dataset.me || '';
  var toast = document.querySelector('.toast');
  function say(text){ if (!toast) return; toast.textContent = text; toast.hidden = false; clearTimeout(say.t); say.t = setTimeout(function(){ toast.hidden = true; }, 2500); }
  function here(){ return location.pathname.slice(BASE.length) + location.search; }
  function toLogin(){ location.href = BASE + '/login/?dest=' + encodeURIComponent(here()); }
  function post(path, form){
    return fetch(BASE + path, { method: 'POST', credentials: 'same-origin', headers: { 'X-Modhash': MH, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form) })
      .then(function(r){ return r.json().catch(function(){ return {}; }).then(function(j){ return { status: r.status, json: j }; }); });
  }
  function problem(a){
    if (a.json && a.json.json && a.json.json.errors && a.json.json.errors.length) return a.json.json.errors[0][1];
    if (a.json && a.json.explanation) return a.json.explanation;
    if (a.status >= 400) return (a.json && a.json.message) || ('Something went wrong (' + a.status + ')');
    return '';
  }
  // votes: Upvote and Downvote on a post or a comment (POST /api/vote)
  document.querySelectorAll('.votes').forEach(function(box){
    box.querySelectorAll('[data-vote]').forEach(function(btn){
      btn.addEventListener('click', function(){
        if (!ME) return toLogin();
        var cur = Number(box.dataset.dir || 0), want = Number(btn.dataset.vote), dir = cur === want ? 0 : want;
        post('/api/vote', { id: box.dataset.thing, dir: String(dir), api_type: 'json' }).then(function(a){
          var p = problem(a); if (p) return say(p);
          box.dataset.dir = String(dir);
          box.classList.toggle('up', dir === 1); box.classList.toggle('down', dir === -1);
          box.querySelector('.vote-up').setAttribute('aria-pressed', String(dir === 1));
          box.querySelector('.vote-down').setAttribute('aria-pressed', String(dir === -1));
          box.querySelector('.score').textContent = String(Number(box.dataset.score) + dir);
        });
      });
    });
  });
  // Share: the post's link, copied; where the page may not write the clipboard (a frame that does not allow it), the link
  // in a read-only field, selected, as Reddit's share panel shows it
  document.querySelectorAll('[data-share]').forEach(function(btn){
    btn.addEventListener('click', function(){
      var url = location.origin + BASE + btn.dataset.share;
      (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function(){ say('Link copied'); }, function(){
        var panel = btn.parentNode.querySelector('.share-panel');
        if (!panel) {
          panel = document.createElement('div'); panel.className = 'share-panel';
          var label = document.createElement('label'); label.textContent = 'Link:';
          var input = document.createElement('input'); input.className = 'post-sharing-link-input'; input.type = 'text'; input.readOnly = true; input.name = 'link';
          input.addEventListener('click', function(){ input.focus(); input.select(); });
          label.appendChild(input); panel.appendChild(label); btn.parentNode.appendChild(panel);
        }
        var field = panel.querySelector('input'); field.value = url; field.focus(); field.select();
      });
    });
  });
  // Join / Joined (POST /api/subscribe)
  document.querySelectorAll('[data-join]').forEach(function(btn){
    btn.addEventListener('click', function(){
      if (!ME) return toLogin();
      var joined = btn.dataset.joined === '1';
      post('/api/subscribe', { action: joined ? 'unsub' : 'sub', sr_name: btn.dataset.join, api_type: 'json' }).then(function(a){
        var p = problem(a); if (p) return say(p);
        btn.dataset.joined = joined ? '0' : '1'; btn.textContent = joined ? 'Join' : 'Joined';
        btn.className = joined ? 'btn-blue' : 'btn-outline';
      });
    });
  });
  // Comment and Reply (POST /api/comment)
  document.querySelectorAll('form[data-comment]').forEach(function(form){
    form.addEventListener('submit', function(e){
      e.preventDefault();
      if (!ME) return toLogin();
      var text = form.querySelector('textarea').value, msg = form.querySelector('.error');
      post('/api/comment', { thing_id: form.dataset.comment, text: text, api_type: 'json' }).then(function(a){
        var p = problem(a); if (p) { msg.textContent = p; return; }
        location.reload();
      });
    });
  });
  document.querySelectorAll('[data-reply-to]').forEach(function(btn){
    btn.addEventListener('click', function(){
      if (!ME) return toLogin();
      var form = document.getElementById('reply-' + btn.dataset.replyTo); if (form) { form.hidden = !form.hidden; if (!form.hidden) form.querySelector('textarea').focus(); }
    });
  });
  // a comment's More options › Delete, confirmed (POST /api/del)
  document.querySelectorAll('[data-menu]').forEach(function(btn){
    btn.addEventListener('click', function(){ var m = document.getElementById('menu-' + btn.dataset.menu); if (m) m.hidden = !m.hidden; });
  });
  document.querySelectorAll('[data-delete]').forEach(function(item){
    item.addEventListener('click', function(){ var d = document.getElementById('confirm-' + item.dataset.delete); item.parentNode.hidden = true; if (d && d.showModal) d.showModal(); });
  });
  document.querySelectorAll('[data-keep]').forEach(function(b){
    b.addEventListener('click', function(){ var d = document.getElementById('confirm-' + b.dataset.keep); if (d) d.close(); });
  });
  document.querySelectorAll('[data-confirm-delete]').forEach(function(b){
    b.addEventListener('click', function(){
      post('/api/del', { id: b.dataset.confirmDelete }).then(function(a){
        var p = problem(a); if (p) return say(p);
        location.reload();
      });
    });
  });
  // Create Post: its tabs, its title's count, its upload, and Post (the media lease and its S3 upload, /api/submit)
  var submit = document.querySelector('form.submit');
  if (submit) {
    var tabs = submit.querySelectorAll('[role="tab"]'), kind = submit.dataset.kind || 'self';
    function show(k){
      kind = k;
      tabs.forEach(function(t){ t.setAttribute('aria-selected', String(t.dataset.kind === k)); });
      submit.querySelectorAll('[role="tabpanel"]').forEach(function(p){ p.hidden = p.dataset.kind !== k; });
    }
    tabs.forEach(function(t){ t.addEventListener('click', function(){ show(t.dataset.kind); }); });
    show(kind);
    var title = submit.querySelector('[name="title"]'), counter = submit.querySelector('.counter');
    function countTitle(){ counter.textContent = title.value.length + '/300'; }
    title.addEventListener('input', countTitle); countTitle();
    var file = submit.querySelector('input[type="file"]'), chosen = submit.querySelector('.chosen');
    // a file chosen is an image or video post, as on reddit.com, whichever tab was showing
    function picked(){ chosen.textContent = file.files[0] ? file.files[0].name : ''; if (file.files[0]) show('image'); }
    file.addEventListener('change', picked);
    submit.querySelector('[data-pick]').addEventListener('click', function(){ file.click(); });
    // a file dropped on the box is chosen as Upload chooses it; one dropped anywhere else on the page is not opened in
    // the page's place
    var drop = submit.querySelector('.drop');
    document.addEventListener('dragover', function(e){ e.preventDefault(); });
    document.addEventListener('drop', function(e){ e.preventDefault(); });
    drop.addEventListener('dragover', function(e){ e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', function(){ drop.classList.remove('over'); });
    drop.addEventListener('drop', function(e){
      e.preventDefault(); drop.classList.remove('over');
      if (e.dataTransfer && e.dataTransfer.files.length) { file.files = e.dataTransfer.files; picked(); }
    });
    var status = submit.querySelector('.progress'), error = submit.querySelector('.error'), button = submit.querySelector('button[type="submit"]');
    function lease(name, type){ return post('/api/media/asset.json', { filepath: name, mimetype: type }); }
    function upload(l, blob, name){
      var form = new FormData();
      l.args.fields.forEach(function(f){ form.append(f.name, f.value); });
      form.append('file', blob, name);
      var host = l.args.action.replace(/^\\/\\//, '');
      var action = PLACED ? BASE + '/@' + host + '/' : 'https://' + host + '/';
      return fetch(action, { method: 'POST', body: form }).then(function(r){ return r.text().then(function(xml){
        if (r.status !== 201) { var m = /<Message>([^<]*)<\\/Message>/.exec(xml); throw new Error(m ? m[1] : 'The upload failed (' + r.status + ')'); }
        return decodeURIComponent(/<Location>([^<]+)<\\/Location>/.exec(xml)[1]);
      }); });
    }
    function leaseAndUpload(blob, name){
      return lease(name, blob.type).then(function(a){
        var p = problem(a); if (p) throw new Error(p);
        return upload(a.json, blob, name);
      });
    }
    function posterOf(f){
      return new Promise(function(resolve, reject){
        var v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = URL.createObjectURL(f);
        v.addEventListener('loadeddata', function(){ v.currentTime = Math.min(0.1, (v.duration || 1) / 2); });
        v.addEventListener('seeked', function(){
          var c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
          c.getContext('2d').drawImage(v, 0, 0);
          c.toBlob(function(b){ b ? resolve(b) : reject(new Error('The video has no frame to show')); }, 'image/png');
        });
        v.addEventListener('error', function(){ reject(new Error('This video could not be read')); });
        // a browser that neither seeks nor fails within ten seconds posts the video without a thumbnail of the page's making
        setTimeout(function(){ reject(new Error('No frame in time')); }, 10000);
      });
    }
    // where the submit's answer sends the person: a link or text post's own page (its url), an image's or a video's the
    // poster's submitted page (user_submitted_page), newest first, as Reddit's answer names no post for media.
    // Where the documentation stops: reddit.com's own page waits on the media's websocket (the answer's websocket_url),
    // which tells it the new post's address once Reddit has made it, and opens the post; the twin models no websocket,
    // so its page goes to the one address the answer names
    function opened(answer){
      var data = answer.json && answer.json.json && answer.json.json.data || {};
      var to = data.url || data.user_submitted_page;
      location.href = BASE + (to ? new URL(to).pathname : '/user/' + encodeURIComponent(ME) + '/submitted/');
    }
    submit.addEventListener('submit', function(e){
      e.preventDefault();
      error.textContent = ''; button.disabled = true;
      var form = { api_type: 'json', sr: submit.querySelector('[name="sr"]').value, title: title.value, sendreplies: 'true', resubmit: 'true', kind: kind };
      var ready;
      // the body, on any tab, as Markdown (the editor's Markdown mode: what is typed is what is sent)
      var body = submit.querySelector('[name="text"]').value;
      if (body.trim()) form.text = body;
      if (kind === 'self') ready = Promise.resolve(form);
      else if (kind === 'link') { form.url = submit.querySelector('[name="url"]').value; ready = Promise.resolve(form); }
      else {
        var f = file.files[0];
        if (!f) { error.textContent = 'Upload an image or a video'; button.disabled = false; return; }
        var isVideo = /^video\\//.test(f.type);
        form.kind = isVideo ? 'video' : 'image';
        status.textContent = 'Uploading ' + f.name + '…';
        ready = leaseAndUpload(f, f.name).then(function(url){
          form.url = url;
          if (!isVideo) return form;
          status.textContent = 'Uploading its thumbnail…';
          // a video the browser cannot draw a frame of is posted without a thumbnail of the page's making
          return posterOf(f).then(function(b){
            return leaseAndUpload(b, f.name.replace(/\\.[^.]+$/, '') + '-poster.png').then(function(p){ form.video_poster_url = p; return form; });
          }, function(){ return form; });
        });
      }
      ready.then(function(sent){
        status.textContent = 'Posting…';
        return post('/api/submit', sent).then(function(a){
          var p = problem(a); if (p) throw new Error(p);
          return opened(a);
        });
      }).catch(function(err){ error.textContent = err.message; status.textContent = ''; button.disabled = false; });
    });
  }
})();
`;

// ── Create Post ─────────────────────────────────────────────────────────────────────────────────

/** The tab a request opens on: Reddit's `type` (TEXT, IMAGE, VIDEO, LINK), else Link when a url is given. */
function tabOf(url: URL): 'self' | 'image' | 'link' {
  const type = (url.searchParams.get('type') ?? '').toUpperCase();
  if (type === 'IMAGE' || type === 'VIDEO' || type === 'MEDIA') return 'image';
  if (type === 'LINK' || url.searchParams.get('url')) return 'link';
  return 'self';
}

/** The page, for the community the path names (or none, at /submit). */
/** Create Post's page (./submit.tsx, and a community's /r/{subreddit}/submit): for the community the path names, or
 *  none. */
export async function submitPage(ctx: HandlerContext, community: string | undefined): Promise<Response> {
  const viewer = await viewerOf(ctx);
  if (!viewer) return toLogin(ctx);
  const url = new URL(ctx.call.request.url);
  const named = community ? subredditNamed(ctx, community) : undefined;
  const choices: Row[] = postableCommunities(ctx, viewer);
  if (named && !choices.some((c) => c.id === named.id)) choices.unshift(named);
  const chosen = named ?? choices.find((c) => c._profile_of === undefined) ?? choices[0];
  const tab = tabOf(url);
  const label = (sr: Row): string => (sr._profile_of !== undefined ? `u/${String(viewer.account.name)}` : `r/${String(sr.display_name)}`);
  const main = (
    <form className="submit" data-kind={tab} noValidate>
      <h1>Create post</h1>
      <div className="field">
        <label htmlFor="sr">Choose a community</label>
        <select id="sr" name="sr" defaultValue={chosen ? String(chosen.display_name) : ''} aria-label="Choose a community">
          {choices.map((sr) => <option key={String(sr.id)} value={String(sr.display_name)}>{label(sr)}</option>)}
        </select>
      </div>
      <div className="tabs" role="tablist" aria-label="Post type">
        <button type="button" role="tab" data-kind="self" aria-selected={tab === 'self'}>Text</button>
        <button type="button" role="tab" data-kind="image" aria-selected={tab === 'image'}>Images &amp; Video</button>
        <button type="button" role="tab" data-kind="link" aria-selected={tab === 'link'}>Link</button>
      </div>
      <div className="field">
        <label htmlFor="title">Title</label>
        <input id="title" type="text" name="title" maxLength={300} required defaultValue={url.searchParams.get('title') ?? ''} aria-label="Title" />
        <span className="counter">0/300</span>
      </div>
      <div className="field" role="tabpanel" data-kind="image" hidden={tab !== 'image'}>
        <div className="drop">
          <span>Drag and drop or upload media</span>
          <button type="button" className="btn-outline" data-pick="media">Upload</button>
          <input id="media" type="file" name="media" accept="image/png,image/jpeg,image/gif,video/mp4,video/quicktime" aria-label="Upload" hidden />
          <span className="chosen" />
        </div>
      </div>
      <div className="field" role="tabpanel" data-kind="link" hidden={tab !== 'link'}>
        <label htmlFor="url">URL</label>
        <input id="url" type="url" name="url" defaultValue={url.searchParams.get('url') ?? ''} aria-label="URL" />
      </div>
      <div className="field">
        <label htmlFor="text">Body</label>
        <textarea id="text" name="text" aria-label="Body" />
      </div>
      <p className="error" role="alert" />
      <p className="progress" aria-live="polite" />
      <div className="submit-row">
        <button type="submit" className="btn-primary">Post</button>
      </div>
    </form>
  );
  return page(ctx, 'Create post', viewer, main, { create: community ? `/r/${community}/submit` : '/submit' });
}


// ── old.reddit.com ─────────────────────────────────────────────────────────────────────────────
// The pages reddit.com still serves at old.reddit.com, drawn from r2's own templates (reddit-archive/reddit): a listing's
// things with their vote arrows, a comments page whose every comment carries r2's reply toggle, and the same session as
// www.reddit.com (r2 sets each cookie on its configured domain, cookies.py `self.domain = g.domain`). Volter Browsers'
// frontline opens old.reddit.com as Reddit's feed and presses a comment's reply toggle (volter-ai/lucarne 83c544c
// packages/lucarne-sites/src/policy.ts:24-26, 44). Every control calls Reddit's own API, as www's page does.
// source: https://raw.githubusercontent.com/reddit-archive/reddit/master/r2/r2/templates/printablebuttons.html "return ${nameFunc}(this)"
// source: https://raw.githubusercontent.com/reddit-archive/reddit/master/r2/r2/templates/printable.html "${arrow_type}vote"
// Where the documentation stops: r2's stylesheets are not copied; the pages are drawn plainly in its markup and words.

/** r2's vote arrows around a thing's score (printable.html `arrow`): each a button by its role and label. */
function OldArrows({ fullname, score, likes }: { fullname: string; score: number; likes: unknown }) {
  const dir = likes === true ? 1 : likes === false ? -1 : 0;
  return (
    <div className={`midcol ${dir === 1 ? 'likes' : dir === -1 ? 'dislikes' : 'unvoted'}`} data-thing={fullname} data-dir={String(dir)} data-score={String(score - dir)}>
      <div className={`arrow ${dir === 1 ? 'upmod' : 'up'} login-required access-required`} data-event-action="upvote" role="button" aria-label="upvote" tabIndex={0} data-old-vote="1" />
      <div className="score unvoted">{String(score)}</div>
      <div className={`arrow ${dir === -1 ? 'downmod' : 'down'} login-required access-required`} data-event-action="downvote" role="button" aria-label="downvote" tabIndex={0} data-old-vote="-1" />
    </div>
  );
}

/** A post in an old.reddit.com listing (link.html): its arrows, title, tagline and its comments link. */
export function OldThing({ post, now }: { post: Row; now: number }) {
  const comments = `/r/${String(post.subreddit)}/comments/${String(post.id)}/`;
  return (
    <div className="thing link" id={`thing_${String(post.name)}`} data-fullname={String(post.name)} data-subreddit={String(post.subreddit)}>
      <OldArrows fullname={String(post.name)} score={Number(post.score ?? 0)} likes={post.likes} />
      <div className="entry unvoted">
        <p className="title"><a className="title" href={post.is_self ? comments : String(post.url)}>{String(post.title)}</a> <span className="domain">({String(post.domain)})</span></p>
        <p className="tagline">submitted <time dateTime={new Date(Number(post.created_utc) * 1000).toISOString()}>{ago(now, Number(post.created_utc))}</time> by <a className="author" href={`/user/${String(post.author)}`}>{String(post.author)}</a> to <a className="subreddit" href={`/r/${String(post.subreddit)}/`}>r/{String(post.subreddit)}</a></p>
        <ul className="flat-list buttons"><li className="first"><a href={comments} className="bylink comments" data-event-action="comments">{`${Number(post.num_comments ?? 0)} comments`}</a></li></ul>
      </div>
    </div>
  );
}

/** A comment on old.reddit.com (comment.html): its arrows, author, body, r2's reply toggle and the reply box it opens. */
export function OldComment({ thing, now }: { thing: Row; now: number }) {
  const c = thing.data as Row;
  const replies = c.replies;
  const kids = replies && typeof replies === 'object' ? (replies as { data?: { children?: Row[] } }).data?.children ?? [] : [];
  return (
    <div className="thing comment" id={`thing_${String(c.name)}`} data-fullname={String(c.name)}>
      <OldArrows fullname={String(c.name)} score={Number(c.score ?? 0)} likes={c.likes} />
      <div className="entry unvoted">
        <p className="tagline"><a className="author" href={`/user/${String(c.author)}`}>{String(c.author)}</a> <time dateTime={new Date(Number(c.created_utc) * 1000).toISOString()}>{ago(now, Number(c.created_utc))}</time></p>
        <div className="usertext-body md" dangerouslySetInnerHTML={{ __html: String(c.body_html).replace(/<!-- SC_O(?:FF|N) -->/g, '') }} />
        <ul className="flat-list buttons"><li className="reply-button" dangerouslySetInnerHTML={{ __html: OLD_REPLY }} /></ul>
        <OldReplyBox thing={String(c.name)} hidden />
      </div>
      <div className="child">{kids.map((k) => <OldComment key={String((k.data as Row).id)} thing={k} now={now} />)}</div>
    </div>
  );
}

/** r2's reply toggle, as its simple_button writes it (printablebuttons.html: `reply` with the comment event). */
const OLD_REPLY = '<a class="access-required" href="javascript:void(0)" data-event-action="comment" onclick="return reply(this)">reply</a>';

/** r2's comment form (`usertext`): the text and save, which posts POST /api/comment for the thing it answers. */
export function OldReplyBox({ thing, hidden }: { thing: string; hidden?: boolean }) {
  return (
    <form className="usertext cloneable" data-old-comment={thing} hidden={hidden}>
      <textarea name="text" aria-label={hidden ? 'reply' : 'comment'} rows={1} cols={1} />
      <p className="error" role="alert" />
      <button type="submit" className="save">save</button>
    </form>
  );
}

/** An old.reddit.com page: r2's header (the person signed in, or its Log in), the content, and the page's script. */
export function oldPage(ctx: HandlerContext, title: string, viewer: Viewer, main: ReactNode, status = 200): Response {
  const base = baseOf(ctx);
  const body = (
    <div className="old" data-base={base ?? ''} data-modhash={viewer?.modhash ?? ''} data-me={viewer ? String(viewer.account.name) : ''}>
      <div id="header" role="banner"><a id="header-img" href={`${base ?? ''}/`}>reddit</a>
        <div id="header-bottom-right">{viewer ? <span className="user"><a href={`${base ?? ''}/user/${String(viewer.account.name)}/`}>{String(viewer.account.name)}</a></span> : <span className="user">Want to join? <a className="login-required" href={`${base ?? ''}/login/?dest=${encodeURIComponent(new URL(ctx.call.request.url).pathname)}`}>Log in</a></span>}</div>
      </div>
      <div className="content" role="main">{main}</div>
      <div className="toast" role="status" aria-live="polite" hidden />
      <script dangerouslySetInnerHTML={{ __html: OLD_JS }} />
    </div>
  );
  return flowPage({ title, css: [OLD_CSS], body, status });
}

const OLD_CSS = `
.old{font:13px/1.4 verdana,arial,helvetica,sans-serif;color:#222;background:#fff}#header{background:#cee3f8;border-bottom:1px solid #5f99cf;padding:6px 10px;display:flex;justify-content:space-between}
#header-img{font-weight:700;color:#000;text-decoration:none}.content{padding:10px}.thing{display:flex;gap:6px;margin:0 0 10px}.thing .child{margin-left:24px;border-left:1px dotted #ddf;padding-left:6px}
.thing.comment{flex-wrap:wrap}.midcol{display:flex;flex-direction:column;align-items:center;width:28px}.arrow{width:15px;height:14px;cursor:pointer;background:#c6c6c6;clip-path:polygon(50% 0,100% 100%,0 100%)}
.arrow.down,.arrow.downmod{transform:rotate(180deg)}.arrow.upmod{background:#ff8b60}.arrow.downmod{background:#9494ff}.score{font-weight:700;color:#c6c6c6}.title a.title{color:#0000ff;font-size:16px}
.domain,.tagline{color:#888;font-size:x-small}.flat-list{list-style:none;padding:0;margin:2px 0;display:flex;gap:6px}.flat-list a{color:#888;font-weight:700;font-size:x-small}
.usertext textarea{width:500px;max-width:100%;height:80px}.toast{position:fixed;bottom:12px;left:12px;background:#333;color:#fff;padding:6px 10px}
`;

const OLD_JS = `
(function(){
  var app = document.querySelector('.old'); if (!app) return;
  var BASE = app.dataset.base || '', MH = app.dataset.modhash || '', ME = app.dataset.me || '';
  var toast = document.querySelector('.toast');
  function say(text){ if (!toast) return; toast.textContent = text; toast.hidden = false; setTimeout(function(){ toast.hidden = true; }, 2500); }
  function toLogin(){ location.href = BASE + '/login/?dest=' + encodeURIComponent(location.pathname.slice(BASE.length)); }
  function post(path, form){
    return fetch(BASE + path, { method: 'POST', credentials: 'same-origin', headers: { 'X-Modhash': MH, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form) })
      .then(function(r){ return r.json().catch(function(){ return {}; }).then(function(j){ return { status: r.status, json: j }; }); });
  }
  function problem(a){
    if (a.json && a.json.json && a.json.json.errors && a.json.json.errors.length) return a.json.json.errors[0][1];
    if (a.status >= 400) return (a.json && a.json.message) || ('Something went wrong (' + a.status + ')');
    return '';
  }
  // r2's reply toggle (printablebuttons.html simple_button): the reply box under the comment, shown or hidden
  window.reply = function(link){
    if (!ME) { toLogin(); return false; }
    var box = link.closest('.entry').querySelector('form[data-old-comment]');
    if (box) { box.hidden = !box.hidden; if (!box.hidden) box.querySelector('textarea').focus(); }
    return false;
  };
  document.querySelectorAll('form[data-old-comment]').forEach(function(form){
    form.addEventListener('submit', function(e){
      e.preventDefault();
      if (!ME) return toLogin();
      post('/api/comment', { thing_id: form.dataset.oldComment, text: form.querySelector('textarea').value, api_type: 'json' }).then(function(a){
        var p = problem(a); if (p) { form.querySelector('.error').textContent = p; return; }
        location.reload();
      });
    });
  });
  // r2's arrows (POST /api/vote)
  document.querySelectorAll('.midcol').forEach(function(col){
    col.querySelectorAll('[data-old-vote]').forEach(function(arrow){
      arrow.addEventListener('click', function(){
        if (!ME) return toLogin();
        var cur = Number(col.dataset.dir || 0), want = Number(arrow.dataset.oldVote), dir = cur === want ? 0 : want;
        post('/api/vote', { id: col.dataset.thing, dir: String(dir), api_type: 'json' }).then(function(a){
          var p = problem(a); if (p) return say(p);
          location.reload();
        });
      });
    });
  });
})();
`;
