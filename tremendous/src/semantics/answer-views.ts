// Dub @ 7e0101363b2a, apps/web/app/(ee)/api/cron/disposable-emails/route.ts:35–41,53.
// The consumer decodes the text into domains before deciding whether to replace its Redis set.
export const answerViews = {
  dubBlocklist: (body: unknown) => {
    const domains = String(body).split('\n').map((domain) => domain.trim().toLowerCase()).filter(Boolean);
    return { text: body, domains, replaceExistingSet: domains.length > 0 };
  },
};
