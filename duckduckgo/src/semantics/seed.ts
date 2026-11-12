import type { SeedCall } from '@volter/world-core';
// Synthetic external web inputs are published through the same World door as journey setup.
export const seed: SeedCall[] = [
  {
    "method": "POST",
    "path": "/_twin/pages",
    "body": {
      "html": "<div class=\"result results_links results_links_deep web-result \"><h2 class=\"result__title\"><a rel=\"nofollow\" class=\"result__a\" href=\"//duckduckgo.com/l/?uddg=https%3A%2F%2Fdocs.example.test%2Fdomain%3Fa%3D1%26b%3D2&amp;rut=world\">Example &amp; Domain</a></h2><a class=\"result__snippet\" href=\"//duckduckgo.com/l/?uddg=https%3A%2F%2Fdocs.example.test%2Fdomain%3Fa%3D1%26b%3D2&amp;rut=world\">Documentation &amp; setup.</a></div>",
      "indexText": "example domain documentation",
      "title": "Example & Domain",
      "href": "//duckduckgo.com/l/?uddg=https%3A%2F%2Fdocs.example.test%2Fdomain%3Fa%3D1%26b%3D2&rut=world",
      "snippet": "Documentation & setup."
    }
  },
  {
    "method": "POST",
    "path": "/_twin/pages",
    "body": {
      "html": "<div class=\"result results_links results_links_deep web-result \"><h2 class=\"result__title\"><a rel=\"nofollow\" class=\"result__a\" href=\"https://news.example.test/domain\">Domain news</a></h2><a class=\"result__snippet\" href=\"https://news.example.test/domain\">New domain guidance.</a></div>",
      "indexText": "example domain news",
      "title": "Domain news",
      "href": "https://news.example.test/domain",
      "snippet": "New domain guidance."
    }
  }
];
