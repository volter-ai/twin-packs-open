// LinkedIn's default data (docs/contributing/architecture.md, "Seeds"): the model-editor campaign's LinkedIn before
// launch day, through the doors that stand in for LinkedIn's own pages (sign-up, Create a Page, the Developer Portal):
// Aaron Yuan, the member the campaign posts from (his name only; a reserved example address), signing in at linkedin.com/login with this password; the page he
// administers, videogame.ai (urn:li:organization:100000001, linkedin.com/company/videogameai), which the campaign's
// sender posts for; and the application registered through the native Developer Portal door.
import type { SeedCall } from '@volter/world-core';

export const seed: SeedCall[] = [
  { method: 'POST', path: '/_twin/members', body: { email: 'aaron@example.com', password: 'videogame-dry-run', given_name: 'Aaron', family_name: 'Yuan' } },
  { method: 'POST', path: '/_twin/organizations', body: { name: 'videogame.ai', vanityName: 'videogameai', admin: 'aaron@example.com', website: 'https://videogame.ai', tagline: 'The game engine powered by AI', description: 'Reimagining the games industry for an AI-only future' } },
  { method: 'POST', path: '/_twin/developer-apps', body: { name: 'Volter Media', products: ['Community Management API'] } },
];
