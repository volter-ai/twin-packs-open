// npm search (libnpmsearch), and every program that lists packages by a keyword (Twenty's app marketplace).
import type { HandlerContext } from '@volter/world-core';
import { mayRead, PACKAGE, type Row, scopeOf } from './shared.ts';

const lower = (s: unknown): string => String(s ?? '').toLowerCase();

/** A manifest's person (`author`) as an object: npm publishes it as one; a string is its name. */
const personOf = (p: unknown): Row | undefined => (p && typeof p === 'object' ? p as Row : typeof p === 'string' && p ? { name: p } : undefined);
/** A manifest field that is a URL or `{ url }` (repository, bugs). */
const urlOf = (f: unknown): string | undefined => (typeof f === 'string' ? f : f && typeof (f as Row).url === 'string' ? String((f as Row).url) : undefined);

/** Whether a package's keywords meet a `keywords:` qualifier: `,` is OR, `+` is AND, `,-` excludes. */
// source: https://raw.githubusercontent.com/npm/registry/main/docs/REGISTRY-API.md "`keywords:batman`: Show/filter results that have `batman` in the keywords"
// source: https://raw.githubusercontent.com/npm/registry/main/docs/REGISTRY-API.md "`,` acts like a logical `OR`"
// source: https://raw.githubusercontent.com/npm/registry/main/docs/REGISTRY-API.md "`+` acts like a logical `AND`"
// source: https://raw.githubusercontent.com/npm/registry/main/docs/REGISTRY-API.md "`,-` can be used to exclude keywords"
function keywordsMeet(value: string, keywords: string[]): boolean {
  const has = new Set(keywords.map(lower));
  const parts = value.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.some((p) => p.startsWith('-') && has.has(lower(p.slice(1))))) return false;
  const wanted = parts.filter((p) => !p.startsWith('-'));
  return wanted.length === 0 || wanted.some((p) => p.split('+').every((k) => has.has(lower(k))));
}

/** `GET /-/v1/search?text=&size=&from=`: packages the text names, with its qualifiers applied. The twin keeps no download
 *  counts, quality or maintenance signals, so every match scores 1 and the order is the packages' names. */
// source: https://raw.githubusercontent.com/npm/registry/main/docs/REGISTRY-API.md "| size | integer | **Query** | ❌         | how many results should be returned (default 20, max 250) |"
// source: https://raw.githubusercontent.com/npm/registry/main/docs/REGISTRY-API.md "Special search qualifiers can be provided in the full-text query:"
export async function libnpmsearch_searchStream(ctx: HandlerContext): Promise<Response> {
  const size = Math.min(250, Math.max(1, Number(ctx.params.size ?? 20) || 20));
  const from = Math.max(0, Number(ctx.params.from ?? 0) || 0);
  const terms = String(ctx.params.text ?? '').split(/\s+/).filter(Boolean);
  const qualifiers = terms.map((t) => /^([a-z-]+):(.+)$/.exec(t)).filter((m): m is RegExpExecArray => m !== null).map((m) => ({ key: m[1]!, value: m[2]! }));
  const words = terms.filter((t) => !/^[a-z-]+:.+$/.test(t)).map(lower);
  const rows = ctx.rowsRaw(PACKAGE).filter((p) => mayRead(ctx, String(p.name), p)).map((p) => {
    const version = String((p['dist-tags'] as Row | undefined)?.latest ?? '');
    const latest = (ctx.own(p).versions as Record<string, Row> | undefined)?.[version];
    return { p, version, latest, manifest: latest ?? {} };
  });
  const hits = rows.filter(({ p, version, latest, manifest }) => {
    const name = String(p.name);
    const keywords = (Array.isArray(manifest.keywords) ? manifest.keywords : []).map(String);
    const unstable = Number(version.split('.')[0]) < 1;
    for (const { key, value } of qualifiers) {
      // source: https://raw.githubusercontent.com/npm/registry/main/docs/REGISTRY-API.md "`author:bcoe`: Show/filter results in which `bcoe` is the author"
      if (key === 'author' && ![personOf(manifest.author)?.name, (latest?._npmUser as Row | undefined)?.name].some((n) => lower(n) === lower(value))) return false;
      // source: https://raw.githubusercontent.com/npm/registry/main/docs/REGISTRY-API.md "`maintainer:bcoe`: Show/filter results in which `bcoe` is qualifier as a maintainer"
      if (key === 'maintainer' && !((p.maintainers as Row[] | undefined) ?? []).some((m) => lower(m.name) === lower(value))) return false;
      // source: https://raw.githubusercontent.com/npm/registry/main/docs/REGISTRY-API.md "`scope:foo`: Show/filter results published under the `@foo` scope"
      if (key === 'scope' && scopeOf(name) !== value.replace(/^@/, '')) return false;
      if (key === 'keywords' && !keywordsMeet(value, keywords)) return false;
      // source: https://raw.githubusercontent.com/npm/registry/main/docs/REGISTRY-API.md "`not:unstable`: Exclude packages whose version is `< 1.0.0`"
      if (key === 'not' && value === 'unstable' && unstable) return false;
      // source: https://raw.githubusercontent.com/npm/registry/main/docs/REGISTRY-API.md "`is:unstable`: Show/filter packages whose version is `< 1.0.0`"
      if (key === 'is' && value === 'unstable' && !unstable) return false;
      // the twin holds no advisory, so no package is insecure
      if (key === 'is' && value === 'insecure') return false;
    }
    return words.every((w) => [name, String(p.description ?? ''), ...keywords].some((s) => lower(s).includes(w)));
  }).sort((a, b) => String(a.p.name).localeCompare(String(b.p.name)));
  // source: https://raw.githubusercontent.com/npm/registry/main/docs/REGISTRY-API.md "| from | integer | **Query** | ❌         | offset to return results from |"
  const objects = hits.slice(from, from + size).map(({ p, version, latest, manifest }) => {
    const name = String(p.name);
    const npmUser = latest?._npmUser as Row | undefined;
    const author = personOf(manifest.author);
    const repository = urlOf(manifest.repository);
    const bugs = urlOf(manifest.bugs);
    return {
      package: {
        name, scope: scopeOf(name) ?? 'unscoped', version, description: p.description ?? manifest.description ?? '',
        keywords: Array.isArray(manifest.keywords) ? manifest.keywords : [],
        date: (p.time as Row | undefined)?.[version] ?? (p.time as Row | undefined)?.modified,
        links: {
          npm: `https://www.npmjs.com/package/${name}`,
          ...(typeof manifest.homepage === 'string' ? { homepage: manifest.homepage } : {}),
          ...(repository ? { repository } : {}),
          ...(bugs ? { bugs } : {}),
        },
        ...(author ? { author } : {}),
        ...(npmUser ? { publisher: { username: npmUser.name, email: npmUser.email } } : {}),
        maintainers: ((p.maintainers as Row[] | undefined) ?? []).map((m) => ({ username: m.name, email: m.email })),
      },
      score: { final: 1, detail: { quality: 1, popularity: 1, maintenance: 1 } }, searchScore: 1,
    };
  });
  return Response.json({ objects, total: hits.length, time: ctx.occurredAt });
}
