import { frontNotFound } from './shared.ts';

// source: recording:gap.json "<title>404 Not Found</title>"
// Captured front response: spec/recordings/gap.json (SOURCE.md). No authenticated unknown-path body is documented;
// that boundary uses the observed front 404, while the manifest gates unauthenticated protected-prefix requests first.
export async function gap(): Promise<Response> {
  return frontNotFound();
}
