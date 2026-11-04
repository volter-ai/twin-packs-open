// CREATE POST — www.reddit.com/submit and /r/{subreddit}/submit (twin-world's architecture, "Screens": a hosted flow an
// application sends a person to, and the page a person posts from). A person signed in chooses a community, a title and
// what the post carries (Text, Images & Video, Link), and Post sends it through Reddit's own API from the page: an
// upload is leased (POST /api/media/asset.json) and posted to its S3 form, a video's first frame becomes its thumbnail
// the same way, and POST /api/submit makes the post; the page then opens it. The videogame.ai site's Share › Reddit
// sends a person here with `url` and `title`, which fill the Link tab. A person signed out signs in first and returns.
import type { HandlerContext } from '@volter/world-core';
import { submitPage } from './shared.tsx';

export async function screen(ctx: HandlerContext): Promise<Response> {
  return submitPage(ctx, undefined);
}
