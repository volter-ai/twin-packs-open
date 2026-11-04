// Tinybird's state machines, each move cited.
import type { StateField } from '@volter/world-core';

const ENDPOINTS = 'https://www.tinybird.co/docs/api-reference/pipe-api/api-endpoints';

/** A Pipe's `endpoint`: the id of the node it publishes, or null. "POST /v0/pipes/(.+)/nodes/(.+)/endpoint:
 *  Publishes an API endpoint", whose answer carries `"endpoint": <that node's id>`. The twin lets a published Pipe
 *  publish another of its nodes, moving the endpoint there; the page says nothing either way. Unpublishing (`DELETE
 *  …/endpoint`) is an operation no demand or life step sends: the gap, so no move back is declared. Not moves of this
 *  field: a Pipe created with an endpoint node is published at its create, which is a create; a Pipe with a materialized
 *  node publishes nothing and the twin refuses the publish (semantics/pipes.ts, 400), where the documentation stops at
 *  "400 Wrong node id". */
const pipeEndpoint: StateField = {
  initial: 'unpublished',
  derive: [
    { state: 'unpublished', when: { absent: true } },
    { state: 'published', when: { truthy: true } },
  ],
  transitions: [
    { operation: 'pipe_set_endpoint', from: ['unpublished', 'published'], to: 'published', source: ENDPOINTS },
  ],
};

export const states = {
  Pipe: { state: { endpoint: pipeEndpoint } },
};
