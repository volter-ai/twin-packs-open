# anthropic customer life: outline

## The customer

**Northdesk** is a fourteen-person company in Ghent that sells help-desk software to small retailers. It runs three
applications on the Claude API, each unchanged from its repository, and its engineers work with Claude Code:

- **Twenty** (twentyhq/twenty at `1d561b8c73c9`), its CRM, whose AI agents answer the sales team's questions about accounts
  and draft follow-ups with tools (`@ai-sdk/anthropic`, streamed, with tool calls and their results);
- **LibreChat** (LibreChat-AI/LibreChat at `f10b1d91f1ee`), the staff's chat, with extended thinking, prompt caching
  and images (`@anthropic-ai/sdk` through `@librechat/agents`, streamed; conversation titles not streamed), which lists
  the models its key can use when it starts;
- **Dub** (dubinc/dub at `7e0101363b2a`), its short links, whose AI features make filters and CSV mappings as structured
  output and answer support chat (`@ai-sdk/anthropic`: `Output.object` as `output_config.format`, `streamText`);
- **Claude Code**, which its engineers run through Volter Harness with the key, sending its turns and its token counts
  through the SDK's beta namespace (`/v1/messages?beta=true`, `/v1/messages/count_tokens?beta=true`).

Everything is in one organization with its Default workspace. The World clock starts 2026-01-01; adoption begins in October, after the models used here were released.

The twin runs no model: a turn is the World's scenario's when it scripts one, else the labeled deterministic stub, in
the Messages API's own shapes (the answer, the stream's events, `tool_use`, `stop_reason`, `usage`). The life names scenario.json: synthetic account data, policy answers and filters are scripted; other turns use the labeled stub.

## People and programs

| who | what they hold | how |
|---|---|---|
| Maarten Declercq, CTO, the organization's admin | his Console login | makes and deletes the API keys on the Console's API keys page |
| Twenty's server | `ANTHROPIC_API_KEY` (key "twenty-prod") | the AI SDK's provider |
| LibreChat's server | `ANTHROPIC_API_KEY` (key "librechat") | `@anthropic-ai/sdk` |
| Dub's server | `ANTHROPIC_API_KEY` (key "dub") | the AI SDK's provider |
| Claude Code under the harness | `ANTHROPIC_API_KEY` (key "claude-code") | Claude Code's own requests |

Every key is a workspace key of the Default workspace: it acts as no one and works until it is deleted
(https://platform.claude.com/docs/en/manage-claude/authentication).

## The arc

### 1. Keys (Mon 5 Oct)
Maarten signs in to the Console and makes the four keys on the API keys page, each shown once. LibreChat's initial setup has a mistyped key, refused 401 `authentication_error`; its configuration is corrected. LibreChat starts and lists the models its key can
use (`GET /v1/models`): newest first, each with its context window, its output limit and what it supports (adaptive or
manual thinking, the effort levels).

### 2. The staff's chat (from Tue 6 Oct, sampled)
A LibreChat turn streams: `message_start`, a `thinking` block (extended thinking with a budget), a `text` block,
`message_delta` with `stop_reason: end_turn` and the usage, `message_stop`. A long system prompt carries a
`cache_control` breakpoint: the first turn reports `cache_creation_input_tokens`, the next within five minutes
`cache_read_input_tokens`. A pasted screenshot goes as an image block. The conversation's title is made with a short,
unstreamed call. While editing a preset the administrator forgets `max_tokens`, and a turn is refused 400
`invalid_request_error`. Restoring that field fixes the preset and the conversation resumes.

### 3. The CRM's agents (from Mon 12 Oct, sampled)
A Twenty agent's turn is streamed with tools: the answer is a `tool_use` block (`stop_reason: tool_use`), the agent runs
the tool and sends its `tool_result`, and the next turn answers in text. The sales rep then asks for a renewal draft, which forces draft_email; the final account summary disables tool use.

### 4. Dub's AI features (from Wed 4 Nov, sampled)
Dub makes link filters from a sentence: `Output.object` sends `output_config.format` with a JSON schema, and the
answer's text is JSON that satisfies the schema. Its support chat streams.

### 5. Claude Code (from Mon 9 Nov)
Claude Code's turns go through the SDK's beta namespace: streamed, with tools, `cache_control` on the system prompt and
thinking; and its token counts (`/v1/messages/count_tokens?beta=true`), which answer `input_tokens` for the same request
without making a message.

### 6. A leaked key (Thu 19 Nov)
The "dub" key is pasted into a public issue. Maarten deletes it on the API keys page and makes "dub-2"; the old key is
refused from that moment and Dub's next call, with the new key, succeeds.

### 7. Leaving (Fri 18 Dec)
Northdesk moves its chat to another provider and removes LibreChat's key; the other keys stay.

## What the life does not do
Message Batches, Files, Skills, Managed Agents, a single model's read, the non-beta token count, the Admin API and every
other beta surface: no application calls them. Rate limits and overloads are the scenario's to script (a fault), and the customer life scripts no faults.
