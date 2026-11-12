import { fallback, type HandlerContext } from './shared.ts';
// source: recording:unknown-path.html "volter-world-unserved-path at DuckDuckGo"
export async function gap(_ctx: HandlerContext): Promise<Response> {
  return fallback();
}
