// The account's pages on the World's board (twin-world's architecture, "The board is the World's pages"): each Custom
// Domain a Worker answers is a site, seen at its hostname as the Worker serves it, grouped by the account it is in; and
// each HTML file of the Worker's static assets is a page of the site under it, at the path the asset worker serves it
// at under the assets' html_handling (../../../src/semantics/shared.ts getIntent: `/blog/index.html` at `/blog/` and
// `/about.html` at `/about` by default), the root's own index.html being the site's page itself. A site's changes are
// its domain's and its Worker's: a deploy writes the script, whose assets manifest is what is served, and its
// deployment, attaching the domain writes the domain; a page's are its Worker's. A site is the World's own (`ours`) when
// its domain is in an account the World holds, its Worker missing or not, or a Worker of the World's answers it: the
// World deploys every Worker its state holds.
import type { BoardFrame, HandlerContext } from '@volter/world-core';
import { ACCOUNT, DEPLOYMENT, SCRIPT, sameAccount, scriptNameOf, type Row } from './shared.ts';

const DOMAIN = 'worker_domain';

export function board(ctx: HandlerContext): BoardFrame[] {
  // each account under the id it has now (the real account's once a deploy adopted it) and the World's it was made under
  const accounts = ctx.rowsRaw(ACCOUNT).filter((a) => a.deleted !== true).map((a) => ({ row: a, id: ctx.resolve(ACCOUNT, String(a.id)) }));
  const accountFor = (id: string): { row: Row; id: string } | undefined => accounts.find((a) => sameAccount(ctx, a.row.id, id));
  return ctx.rowsRaw(DOMAIN).filter((d) => d.deleted !== true).sort((a, b) => String(a.hostname).localeCompare(String(b.hostname))).flatMap((d): BoardFrame[] => {
    const account = accountFor(String(d.account_id));
    const id = account?.id ?? ctx.resolve(ACCOUNT, String(d.account_id));
    const scripts = ctx.rowsRaw(SCRIPT).filter((s) => s.deleted !== true && scriptNameOf(s) === String(d.service) && sameAccount(ctx, s.account_id, id));
    const keys = new Set(scripts.map((s) => String(s.id)));
    const aka = [...new Set([String(d.account_id), ...(account ? [String(account.row.id)] : [])])].filter((x) => x !== id).map((x) => `account:${x}`);
    const section = { id: `account:${id}`, title: String(account?.row.name ?? id), ...(aka.length ? { aka } : {}) };
    const worker = [
      ...scripts.map((s) => ({ type: SCRIPT, id: String(s.id) })),
      ...ctx.rowsRaw(DEPLOYMENT).filter((x) => keys.has(String(x.script))).map((x) => ({ type: DEPLOYMENT, id: String(x.id) })),
    ];
    const ours = account !== undefined || scripts.length > 0;
    const site = `site:${String(d.hostname)}`;
    // the script the hostname is served by (workerDomainAnswer takes the first), and the HTML pages of its assets
    const assets = scripts[0]?.assets as { manifest?: Record<string, unknown>; config?: { html_handling?: string } } | null | undefined;
    const paths = [...new Set(Object.keys(assets?.manifest ?? {}).filter((f) => f.endsWith('.html')).map((f) => servedAt(f, assets?.config?.html_handling)))]
      .filter((p) => p !== '/').sort();
    return [
      {
        id: site, kind: 'site', title: String(d.hostname), section, url: `https://${String(d.hostname)}/`,
        covers: [{ type: DOMAIN, id: String(d.id) }, ...worker],
        ...(ours ? { ours: true } : {}),
      },
      ...paths.map((p): BoardFrame => ({
        id: `page:${String(d.hostname)}${p}`, kind: 'page', title: p, section, url: `https://${String(d.hostname)}${p}`,
        covers: worker, parent: site,
        ...(ours ? { ours: true } : {}),
      })),
    ];
  });
}

/** The path the asset worker serves an HTML file at, under the assets' html_handling (auto-trailing-slash when unset):
 *  the path a request for the file itself is redirected to (getIntent, ported from workers-shared's asset worker). */
function servedAt(file: string, mode = 'auto-trailing-slash'): string {
  if (mode === 'none') return file;
  const index = file.endsWith('/index.html');
  const base = index ? file.slice(0, -'index.html'.length) : file.slice(0, -'.html'.length);
  if (mode === 'force-trailing-slash') return base.endsWith('/') ? base : `${base}/`;
  if (mode === 'drop-trailing-slash') return base === '/' || !base.endsWith('/') ? base : base.slice(0, -1);
  return base;
}
