// A COMPANY PAGE — www.linkedin.com/company/{vanity name or id}/ and its Posts tab, /posts/ (a workspace,
// docs/contributing/architecture.md, "Screens"): the page's name, tagline and about, and its posts newest first. A
// member who posts for the page is offered "Start a post" there, which opens the composer posting as the page
// (./feed.tsx).
import type { HandlerContext } from '@volter/world-core';
import { mediaSigner, nowMs, ORGANIZATION, type Row } from '../semantics/shared.ts';
import { Avatar, cannotDisplay, GlobalNav, memberOf, page, pagesOf, postsBy, toSignIn, Update } from './shared.tsx';

export async function screen(ctx: HandlerContext): Promise<Response> {
  const member = memberOf(ctx);
  const key = String(ctx.call.params.company ?? '').toLowerCase();
  const org = ctx.rowsRaw(ORGANIZATION).find((o) => String(o.vanityName).toLowerCase() === key || String(o.id) === key);
  if (!org) return cannotDisplay(ctx, member, 'Page not found', 'This page doesn’t exist');
  const tab = /\/posts\/?$/.test(new URL(ctx.call.request.url).pathname) ? 'posts' : 'home';
  // a page's Posts tab is a member's: a visitor is sent to sign in (./shared.tsx toSignIn); its home is anyone's
  if (tab === 'posts' && !member) return toSignIn(ctx);
  const urn = `urn:li:organization:${String(org.id)}`;
  const manages = member ? pagesOf(ctx, member).some((o) => o.id === org.id) : false;
  const posts = postsBy(ctx, new Set([urn]), member);
  const shown = tab === 'posts' ? posts : posts.slice(0, 3);
  const base = `/company/${String(org.vanityName)}`;
  const now = nowMs(ctx);
  const sign = await mediaSigner(ctx);
  return page(ctx, `${String(org.localizedName)}${tab === 'posts' ? ': Posts' : ''}`, (
    <>
      <GlobalNav member={member} />
      <main className="layout layout-wide">
        <div>
          <section className="card" aria-label={String(org.localizedName)}>
            <div className="org-top" />
            <div className="org-head">
              <div className="org-logo" style={{ display: 'inline-block' }}><Avatar name={String(org.localizedName)} kind="org" size={88} /></div>
              <h1 className="org-name">{String(org.localizedName)}</h1>
              {org._tagline ? <div>{String(org._tagline)}</div> : null}
              {org.localizedWebsite ? <div className="small"><a href={String(org.localizedWebsite)} rel="noopener noreferrer" target="_blank">{String(org.localizedWebsite).replace(/^https?:\/\//, '')}</a></div> : null}
            </div>
            <nav className="org-tabs" aria-label="Organization's page navigation">
              <a className={tab === 'home' ? 'active' : undefined} href={`${base}/`} aria-current={tab === 'home' ? 'page' : undefined}>Home</a>
              <a className={tab === 'posts' ? 'active' : undefined} href={`${base}/posts/`} aria-current={tab === 'posts' ? 'page' : undefined}>Posts</a>
            </nav>
          </section>
          {manages ? (
            <section className="card share-box" aria-label="Share box">
              <div className="share-box__open">
                <Avatar name={String(org.localizedName)} kind="org" size={48} />
                <a className="share-box__trigger" href={`/feed/?shareActive=true&actor=${encodeURIComponent(urn)}`}>Start a post</a>
              </div>
            </section>
          ) : null}
          {tab === 'home' && org.localizedDescription ? <section className="card"><div className="card-body"><h2 style={{ fontSize: 20, margin: '0 0 8px' }}>About</h2><p>{String(org.localizedDescription)}</p></div></section> : null}
          {shown.length ? shown.map((p: Row) => <Update key={String(p.id)} ctx={ctx} post={p} member={member} now={now} sign={sign} />)
            : <section className="card empty"><p className="muted">{String(org.localizedName)} hasn’t posted yet.</p></section>}
          {tab === 'home' && posts.length > shown.length ? <a className="btn" href={`${base}/posts/`}>Show all posts</a> : null}
        </div>
        <aside />
      </main>
    </>
  ));
}
