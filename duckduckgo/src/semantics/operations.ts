import { browserAnswer, type HandlerContext } from './shared.ts';
// source: recording:browser-search.html "example domain at DuckDuckGo"
// source: recording:browser-search.html "DDG.deep.anomalyDetectionBlock"
export async function browserSearch(ctx: HandlerContext): Promise<Response> {
  return browserAnswer(new URL(ctx.call.request.url).searchParams.get('q') ?? '');
}
