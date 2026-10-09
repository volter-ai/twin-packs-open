// Resend's local document palette follows retained official Email Details pixels (spec/screen-references.json).
// Shared layout/type tokens remain; no vendor image, asset or script is shipped.
import type { HandlerContext } from '@volter/world-core';
import { flowPage } from '@volter/world-ui';
import { list } from '../semantics/shared.ts';

export type Body = Parameters<typeof flowPage>[0]['body'];
export const at = (ctx: HandlerContext, path: string): string => `${ctx.publicBase}${path}`;
export const detailPath = (id: unknown, team: string, view = 'preview'): string =>
  `/emails/${encodeURIComponent(String(id))}?${new URLSearchParams({ team, view })}`;
export const addresses = (value: unknown): string => list(value).join(', ');
export const statusLabel = (value: unknown): string => String(value ?? '').replace(/_/g, ' ').replace(/^./, (letter) => letter.toUpperCase());
export const statusTone = (value: unknown): string => ['delivered', 'opened', 'clicked'].includes(String(value)) ? 'healthy' :
  ['bounced', 'complained', 'failed', 'suppressed'].includes(String(value)) ? 'danger' : 'neutral';
export const dateLabel = (value: unknown): string => {
  if (typeof value !== 'string' || !value) return '—';
  // The API stores its own timestamp form, with a space and +00. Format its actual instant in UTC.
  const date = new Date(value.replace(' ', 'T').replace(/\+00$/, 'Z'));
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'UTC',
  });
};
export const Badge = ({ value }: { value: unknown }) => <span className={`re-badge re-${statusTone(value)}`}>{statusLabel(value) || '—'}</span>;

export function page(ctx: HandlerContext, title: string, teams: string[], team: string, body: Body, status = 200): Response {
  return flowPage({ title: `${title} | Resend`, css: [BRAND_CSS, RESEND_CSS, CSS], status,
    headers: { 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; frame-src 'self'; base-uri 'none'; form-action 'self'" }, body:
    <div className="re-shell">
      <aside className="re-sidebar"><a className="re-wordmark" href={at(ctx, `/emails?${new URLSearchParams({ team })}`)}>Resend</a>
        {teams.length > 1 ? <form className="re-team" method="get" action={at(ctx, '/emails')}>
          <label htmlFor="team">Team</label><select id="team" name="team" defaultValue={team}>{teams.map((name) => <option key={name}>{name}</option>)}</select><button>Switch</button>
        </form> : team ? <span className="re-team-name">{team}</span> : null}
        <nav aria-label="Resend"><a href={at(ctx, `/emails?${new URLSearchParams({ team })}`)} aria-current="page">Emails</a></nav>
      </aside>
      <div className="re-workspace"><div className="re-topbar"><span>Emails</span></div>
        <main><header className="re-heading"><h1>{title}</h1></header>{body}</main>
      </div>
    </div>,
  });
}

// Exact retained official detail-image pixels and original sample regions are recorded in spec/screen-references.json.
// These colors belong only to this vendor document; shared typography, dimensions and status roles stay intact.
export const RESEND_CSS = `
:root {
  --resend-surface-page: #05050a;
  --resend-text-primary: #eaebed;
  --resend-text-muted: #969aa0;
  --resend-surface-raised: #16171c;
  --resend-surface-selected: #23252c;
  --resend-surface-tab-selected: #2d3037;
  --resend-border-default: #23252c;
  --resend-border-subtle: var(--resend-border-default);
}
`;

export const CSS = `
* { box-sizing: border-box; }
:root { color-scheme: dark; }
body { margin: 0; background: var(--resend-surface-page); color: var(--resend-text-primary); font: var(--volter-font-size-md)/1.5 var(--volter-font-ui); }
a { color: inherit; text-decoration: none; }
a:hover { text-decoration: underline; }
button, input, select { font: inherit; }
button, input, select, a { outline-offset: 4px; }
button, input, select { background: var(--resend-surface-raised); color: var(--resend-text-primary); border: 1px solid var(--resend-border-default); border-radius: var(--volter-radius-control); padding: var(--volter-space-2) var(--volter-space-3); }
button { cursor: pointer; }
.re-shell { display: grid; grid-template-columns: 220px minmax(0, 1fr); min-height: 100vh; }
.re-sidebar { border-right: 1px solid var(--resend-border-default); padding: var(--volter-space-6) var(--volter-space-4); }
.re-wordmark { display: block; font-size: var(--volter-font-size-xl); font-weight: 650; margin: 0 var(--volter-space-2) var(--volter-space-6); }
.re-team-name { display: block; color: var(--resend-text-muted); padding: 0 var(--volter-space-2); margin-bottom: var(--volter-space-6); }
.re-team { display: grid; gap: var(--volter-space-2); margin-bottom: var(--volter-space-6); }
.re-team label { color: var(--resend-text-muted); font-size: var(--volter-font-size-sm); }
.re-team select { width: 100%; }
.re-sidebar nav a { display: block; background: var(--resend-surface-selected); border: 1px solid var(--resend-border-default); border-radius: var(--volter-radius-control); padding: var(--volter-space-2) var(--volter-space-3); }
.re-topbar { height: 60px; border-bottom: 1px solid var(--resend-border-default); display: flex; align-items: center; padding: 0 var(--volter-space-6); color: var(--resend-text-muted); font-size: var(--volter-font-size-sm); }
main { padding: var(--volter-space-8) var(--volter-space-8) var(--volter-space-16); max-width: 1440px; }
.re-heading { margin-bottom: var(--volter-space-8); }
h1 { margin: 0; font-size: var(--volter-font-size-3xl); font-weight: 600; letter-spacing: -.03em; }
h2 { margin: 0 0 var(--volter-space-4); font-size: var(--volter-font-size-sm); font-weight: 500; text-transform: uppercase; color: var(--resend-text-muted); }
.re-filters { display: flex; gap: var(--volter-space-2); flex-wrap: wrap; margin-bottom: var(--volter-space-5); }
.re-search { flex: 1; min-width: 180px; }
.re-table-scroll { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; text-align: left; }
thead { background: var(--resend-surface-raised); color: var(--resend-text-muted); }
th { font-weight: 500; padding: var(--volter-space-3); font-size: var(--volter-font-size-sm); }
td { border-bottom: 1px solid var(--resend-border-subtle); padding: var(--volter-space-4) var(--volter-space-3); }
tbody tr:hover { background: var(--resend-surface-raised); }
td a { display: block; }
.re-recipient { min-width: 190px; overflow-wrap: anywhere; }
.re-subject { min-width: 240px; }
.re-date { color: var(--resend-text-muted); white-space: nowrap; font-size: var(--volter-font-size-sm); }
.re-badge { display: inline-block; border-radius: var(--volter-radius-control); padding: var(--volter-space-1) var(--volter-space-2); font-size: var(--volter-font-size-sm); background: var(--resend-surface-raised); color: var(--resend-text-muted); white-space: nowrap; }
.re-healthy { background: var(--volter-status-healthy-soft); color: var(--volter-status-healthy-text); }
.re-danger { background: var(--volter-status-danger-soft); color: var(--volter-status-danger-text); }
.re-muted { color: var(--resend-text-muted); font-size: var(--volter-font-size-sm); }
.re-empty { padding: var(--volter-space-12) var(--volter-space-4); text-align: center; color: var(--resend-text-muted); }
.re-back { display: inline-block; margin-bottom: var(--volter-space-6); color: var(--resend-text-muted); }
.re-details { display: grid; grid-template-columns: 1fr 1fr; gap: var(--volter-space-6) var(--volter-space-8); margin: 0 0 var(--volter-space-8); }
.re-details div { min-width: 0; }
.re-details dt { margin-bottom: var(--volter-space-1); color: var(--resend-text-muted); font-size: var(--volter-font-size-sm); text-transform: uppercase; }
.re-details dd { margin: 0; overflow-wrap: anywhere; }
.re-details code { font: var(--volter-font-size-sm)/1.5 var(--volter-font-data); }
.re-events { display: flex; gap: var(--volter-space-6); list-style: none; padding: var(--volter-space-4) 0 var(--volter-space-6); margin: 0 0 var(--volter-space-6); overflow-x: auto; border-bottom: 1px solid var(--resend-border-default); }
.re-events li { display: flex; flex-direction: column; gap: var(--volter-space-2); align-items: flex-start; flex-shrink: 0; }
.re-content { border: 1px solid var(--resend-border-default); border-radius: var(--volter-radius-panel); overflow: hidden; }
.re-tabs { display: flex; gap: var(--volter-space-2); padding: var(--volter-space-3); border-bottom: 1px solid var(--resend-border-default); }
.re-tabs a { padding: var(--volter-space-1) var(--volter-space-2); border-radius: var(--volter-radius-control); color: var(--resend-text-muted); }
.re-tabs [aria-current=page] { background: var(--resend-surface-tab-selected); color: var(--resend-text-primary); }
.re-preview { display: block; border: 0; width: 100%; height: 560px; background: var(--resend-surface-raised); }
.re-code { padding: var(--volter-space-6); margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font: var(--volter-font-size-sm)/1.6 var(--volter-font-data); }
@media (max-width: 800px) { .re-shell { grid-template-columns: 160px minmax(0, 1fr); } main { padding: var(--volter-space-6) var(--volter-space-4); } .re-details { grid-template-columns: 1fr; } h1 { font-size: var(--volter-font-size-2xl); } }
@media (max-width: 560px) { .re-shell { display: block; } .re-sidebar { display: flex; align-items: center; gap: var(--volter-space-4); padding: var(--volter-space-4); border-right: 0; border-bottom: 1px solid var(--resend-border-default); } .re-wordmark, .re-team-name { margin: 0; padding: 0; } .re-team-name, .re-topbar { display: none; } .re-team { margin: 0; } .re-team label { display: none; } .re-sidebar nav { margin-left: auto; } }
`;

// BRAND_CSS is emitted here from @volter-ai/brand/tokens by the authoring command recorded in task provenance.
// The generated declarations are served inline; no brand or email assets are fetched at runtime.
export const BRAND_CSS = ":root {\n  --volter-surface-page: light-dark(#f7f6f1, #0f1a1f);\n  --volter-text-primary: light-dark(#16252c, #f3f2ec);\n  --volter-font-size-md: 14px;\n  --volter-font-ui: \"Geist\", \"Segoe UI\", system-ui, sans-serif;\n  --volter-surface-raised: light-dark(#fbfaf7, #16252c);\n  --volter-border-default: light-dark(#d9dad3, #2c3d45);\n  --volter-radius-control: 3px;\n  --volter-space-2: 8px;\n  --volter-space-3: 12px;\n  --volter-space-6: 24px;\n  --volter-space-4: 16px;\n  --volter-font-size-xl: 20px;\n  --volter-text-muted: light-dark(#5d6970, #a9b0ad);\n  --volter-font-size-sm: 12.5px;\n  --volter-space-8: 32px;\n  --volter-space-16: 64px;\n  --volter-font-size-3xl: 32px;\n  --volter-space-5: 20px;\n  --volter-border-subtle: light-dark(#e9e8e1, #223239);\n  --volter-space-1: 4px;\n  --volter-status-healthy-soft: light-dark(#e8f0e6, rgba(111, 191, 142, 0.14));\n  --volter-status-healthy-text: light-dark(#2f5f40, #93d3aa);\n  --volter-status-danger-soft: light-dark(#fbebe4, rgba(240, 118, 80, 0.14));\n  --volter-status-danger-text: light-dark(#9c3310, #f59a7d);\n  --volter-space-12: 48px;\n  --volter-font-data: \"Geist Mono\", ui-monospace, \"SF Mono\", Menlo, Consolas, monospace;\n  --volter-radius-panel: 4px;\n  --volter-font-size-2xl: 24px;\n}\n";
