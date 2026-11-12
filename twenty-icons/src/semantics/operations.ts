// The operations family (every path of the vendor's is a domain or the root): GET /{domainName}, a domain's favicon
// (FaviconController.getFaviconWithSize with no size), and GET /, the root's redirect to the service's README.
import type { HandlerContext } from '@volter/world-core';
import { DEFAULT_SIZE, EDGE_CACHE, ICON, SUPPORTED_SIZES, faviconPng, httpDate, text, validDomain } from './shared.ts';

// source: spec:getFavicon "Return the domain's favicon as a PNG at the highest available supported size."
export async function getFavicon(ctx: HandlerContext): Promise<Response> {
  const domain = String(ctx.call.params.domainName ?? '');
  // source: https://raw.githubusercontent.com/twentyhq/favicon/fb84fc14394ee60a675fa88a892b912cb4329557/src/favicon/favicon.controller.ts "return res.status(400).send('Invalid domain');"
  if (!validDomain(domain)) return text(ctx, 400, 'Invalid domain');
  // the vendor fetches the site at https://<domain>, then, when that finds no favicon, at https://www.<domain>
  // (favicon.service.ts:55-68): a domain is known when it is declared, else when www.<domain> is
  // source: https://raw.githubusercontent.com/twentyhq/favicon/fb84fc14394ee60a675fa88a892b912cb4329557/src/favicon/favicon.service.ts "const alternativeUrl = `https://www.${domainName}`;"
  const icon = ctx.row(ICON, domain) ?? ctx.row(ICON, `www.${domain}`);
  // source: https://raw.githubusercontent.com/twentyhq/favicon/fb84fc14394ee60a675fa88a892b912cb4329557/src/favicon/favicon.controller.ts "return res.status(404).send('Could not fetch favicon');"
  if (!icon) return text(ctx, 404, 'Could not fetch favicon', EDGE_CACHE);
  // with no size asked, the default; the largest stored size not above it answers
  // source: https://raw.githubusercontent.com/twentyhq/favicon/fb84fc14394ee60a675fa88a892b912cb4329557/src/favicon/favicon.service.ts "if (supportedSize <= size) {"
  const size = SUPPORTED_SIZES.filter((s) => s <= Math.min(DEFAULT_SIZE, Number(icon.size))).at(-1)!;
  // source: https://raw.githubusercontent.com/twentyhq/favicon/fb84fc14394ee60a675fa88a892b912cb4329557/src/favicon/favicon.controller.ts "'Content-Type': 'image/png',"
  return new Response(Uint8Array.from(faviconPng(String(icon.domain), size)).buffer, { headers: {
    'content-type': 'image/png',
    ...EDGE_CACHE,
    // the stored file's time, as the host's 200s carry it (spec/SOURCE.md, Answers): when the World declared the domain
    'last-modified': httpDate(String(icon.declaredAt)),
  } });
}

// source: spec:getRoot "Redirect to the service's README."
// source: https://raw.githubusercontent.com/twentyhq/favicon/fb84fc14394ee60a675fa88a892b912cb4329557/src/favicon/favicon.controller.ts "@Redirect('https://github.com/twentyhq/favicon/blob/main/README.md', 301)"
export async function getRoot(_ctx: HandlerContext): Promise<Response> {
  const readme = 'https://github.com/twentyhq/favicon/blob/main/README.md';
  // Express's res.redirect body for an HTML client (the host's answer to GET /: spec/SOURCE.md, Answers)
  return new Response(`<p>Moved Permanently. Redirecting to ${readme}</p>`, { status: 301, headers: { location: readme, 'content-type': 'text/html; charset=utf-8', vary: 'Accept', ...EDGE_CACHE } });
}
