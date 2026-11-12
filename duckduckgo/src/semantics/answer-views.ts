// Pinned Harness selectors and redirect unwrapping: convert.rs:794-874.
// This view checks the consumed HTML structure; it does not execute the Rust application.
const decode = (text: string): string => text.replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, name: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[name]!));
const textOf = (text: string): string => decode(text.replace(/<[^>]*>/g, '')).trim();
export const answerViews = {
  results: (body: unknown) => {
    const html = String(body);
    const titles = [...html.matchAll(/<a\b[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
    const snippets = [...html.matchAll(/<a\b[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)];
    return titles.map((match, i) => {
      const href = decode(match[1]!);
      const target = new URL(href, 'https://duckduckgo.com').searchParams.get('uddg');
      return { title: textOf(match[2]!), url: target ?? (href.startsWith('//') ? 'https:' + href : href), snippet: textOf(snippets[i]![1]!) };
    });
  },
};
