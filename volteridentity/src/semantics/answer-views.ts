// Client authentication headers are computed from the credentials the operator registration answered, as an OAuth
// client encodes them; this view lets the published Basic-authentication rule use the actual issued credentials.
export const answerViews = {
  clientAuthentication(body: unknown): unknown {
    const client = body as Record<string, unknown>;
    return { ...client, basic: `Basic ${btoa(`${encodeURIComponent(String(client.client_id))}:${encodeURIComponent(String(client.client_secret))}`)}` };
  },
};
