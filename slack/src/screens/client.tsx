// Slack's conversation client, authored from its public quick-start images and documented controls.
// No captured DOM, vendor assets or second conversation store. Brand icons and synthetic avatars use the public brand service.
// Reads use the pack's existing
// visibility/message helpers; forms call the published Web API through ordinary browser fetch.
// source: https://slack.com/help/articles/360059928654-How-to-use-Slack--your-quick-start-guide "From the sidebar, you can access the channels you've joined, open your direct messages"
// source: https://slack.com/help/articles/115000769927-Use-threads-to-organize-discussions "Click the Reply in thread icon"
import type { HandlerContext } from '@volter/world-core';
import { flowPage, type ReactNode } from '@volter/world-ui';
import { caller, channelMembers, channelTeam, messageId, messagesIn, messageView, sees, teamsOf, type Caller } from '../semantics/shared.ts';
import { refused, seeOther, visitor } from './shared.tsx';

type Row = Record<string, unknown>;
const nameOf = (u: Row | undefined, fallback = 'Unknown member'): string => {
  const p = u?.profile as Row | undefined;
  return String(p?.display_name || p?.real_name || u?.name || fallback);
};
const clientPath = (team: string, channel?: string): string => `/client/${encodeURIComponent(team)}${channel ? `/${encodeURIComponent(channel)}` : ''}`;
const conversationName = (ctx: HandlerContext, c: Row, by: Caller): string => c.is_im === true || c.is_mpim === true
  ? channelMembers(ctx, String(c.id)).filter((id) => id !== by.user).map((id) => nameOf(ctx.get('user', id), id)).join(', ') || nameOf(ctx.get('user', by.user))
  : String(c.name ?? c.id);
const symbolOf = (c: Row): string => c.is_im === true || c.is_mpim === true ? '' : c.is_private === true ? 'Private · ' : '# ';

// Slack-specific text links and mentions are rendered as React text, never as message-authored HTML.
// source: https://docs.slack.dev/messaging/formatting-message-text "manually add links"
// source: https://docs.slack.dev/messaging/formatting-message-text "they will only see an unclickable"
function textOf(ctx: HandlerContext, text: string) {
  return text.split(/(<[^>]+>|https?:\/\/[^\s<>]+)/g).map((part, i) => {
    const mention = /^<@([^|>]+)(?:\|([^>]+))?>$/.exec(part);
    if (mention) return <span className="sc-mention" key={i}>@{nameOf(ctx.get('user', mention[1]!), mention[2] ?? mention[1])}</span>;
    const channel = /^<#([^|>]+)(?:\|([^>]+))?>$/.exec(part);
    if (channel) {
      const c = ctx.get('channel', channel[1]!);
      const member = visitor(ctx);
      const by = member ? caller(ctx, `xoxp-${member.id}`) : undefined;
      const visible = c && by && !('error' in by) && sees(ctx, c, by);
      return visible && c ? <a className="sc-mention" key={i} href={`${ctx.publicBase}${clientPath(channelTeam(c), String(c.id))}`}>#{String(c.name ?? channel[2] ?? channel[1])}</a>
        : <span className="sc-mention" key={i}>private channel</span>;
    }
    const link = /^<(https?:\/\/[^|>]+)(?:\|([^>]+))?>$/.exec(part);
    if (link) return <a key={i} href={link[1]} target="_blank" rel="noreferrer">{link[2] ?? link[1]}</a>;
    if (/^https?:\/\//.test(part)) return <a key={i} href={part} target="_blank" rel="noreferrer">{part}</a>;
    return part.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  });
}


// source: https://docs.slack.dev/messaging/formatting-message-text/ "Basic visual styles"
// source: https://docs.slack.dev/messaging/formatting-message-text/ "Text within inline code blocks will not use any other formatting"
function mrkdwnOf(ctx: HandlerContext, text: string): ReactNode {
  const literal = (part: string) => part.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  return text.split(/(```[\s\S]*?```|`[^`\n]+`|<[^>]+>|https?:\/\/[^\s<>]+|\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/g).map((part, i) => {
    if (i % 2 === 0) return <span key={i}>{textOf(ctx, part)}</span>;
    if (part.startsWith('```') && part.endsWith('```')) return <pre key={i}>{literal(part.slice(3, -3))}</pre>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={i}>{literal(part.slice(1, -1))}</code>;
    if (part.startsWith('*') && part.endsWith('*')) return <strong key={i}>{textOf(ctx, part.slice(1, -1))}</strong>;
    if (part.startsWith('_') && part.endsWith('_')) return <em key={i}>{textOf(ctx, part.slice(1, -1))}</em>;
    if (part.startsWith('~') && part.endsWith('~')) return <s key={i}>{textOf(ctx, part.slice(1, -1))}</s>;
    return <span key={i}>{textOf(ctx, part)}</span>;
  });
}

/** Text-only block content remains inspectable when an app posts blocks without fallback text. */
function blockText(value: unknown): string {
  if (Array.isArray(value)) return value.map(blockText).filter(Boolean).join('\n');
  if (!value || typeof value !== 'object') return '';
  const b = value as Row;
  if (typeof b.text === 'string') return b.text;
  if (b.type === 'image') return String(b.alt_text ?? '');
  return [blockText(b.text), blockText(b.fields), blockText(b.elements)].filter(Boolean).join('\n');
}

const objects = (value: unknown): Row[] => Array.isArray(value) ? value.filter((item): item is Row => item !== null && typeof item === 'object' && !Array.isArray(item)) : [];
const icon = (name: string, size = 18) => <img src={`https://brand.volter.ai/icon/${name}/svg?size=${size}&color=%23ffffff`} width={size} height={size} alt=""/>;

function richElement(ctx: HandlerContext, element: Row): ReactNode {
  // source: https://docs.slack.dev/reference/block-kit/blocks/rich-text-block/ "Rich text blocks can be deeply nested."
  // source: https://docs.slack.dev/reference/block-kit/block-elements/rich-text-section-element/ "An array of rich text elements."
  const children = objects(element.elements).map((child, i) => <span key={i}>{richElement(ctx, child)}</span>);
  if (element.type === 'rich_text_section') return <span>{children}</span>;
  if (element.type === 'rich_text_quote') return <blockquote className="sc-attachment">{children}</blockquote>;
  if (element.type === 'rich_text_preformatted') return <pre>{children}</pre>;
  if (element.type === 'rich_text_list') {
    // source: https://docs.slack.dev/reference/block-kit/block-elements/rich-text-list-element/ "Sub-list indent level."
    // source: https://docs.slack.dev/reference/block-kit/block-elements/rich-text-list-element/ "Number to offset the first number in the list."
    const items = objects(element.elements).map((item, i) => <li key={i}>{richElement(ctx, item)}</li>);
    const offset = Number(element.offset ?? 0), indent = Number(element.indent ?? 0);
    const style = { marginInlineStart: Number.isFinite(indent) && indent > 0 ? indent * 20 : 0 };
    return element.style === 'ordered' ? <ol start={Number.isInteger(offset) ? offset + 1 : 1} style={style}>{items}</ol> : <ul style={style}>{items}</ul>;
  }
  let content: ReactNode;
  const style = element.style && typeof element.style === 'object' ? element.style as Row : {};
  if (element.type === 'text') content = String(element.text ?? '');
  else if (element.type === 'user') {
    // source: https://docs.slack.dev/reference/block-kit/block-elements/user-element/ "The ID of the user to be mentioned."
    content = <span className="sc-mention">@{nameOf(ctx.get('user', String(element.user_id ?? '')), String(element.user_id ?? ''))}</span>;
  } else if (element.type === 'channel') {
    // source: https://docs.slack.dev/reference/block-kit/block-elements/channel-element/ "The ID of the channel to be mentioned."
    // Same visibility and native channel-link rendering as the plain message text.
    content = textOf(ctx, `<#${String(element.channel_id ?? '')}>`);
  } else if (element.type === 'emoji') {
    // source: https://docs.slack.dev/reference/block-kit/block-elements/emoji-element/ "The name of the emoji;"
    // The name stays readable when the brand service has no drawing for a Slack emoji.
    const name = String(element.name ?? '');
    content = <img className="sc-inline-emoji" src={`https://brand.volter.ai/emoji/${encodeURIComponent(name)}/svg?size=18`} width="18" height="18" alt={`:${name}:`}/>;
  } else if (element.type === 'link') {
    // source: https://docs.slack.dev/reference/block-kit/block-elements/link-element/ "If no text is provided, the url is used."
    const href = String(element.url ?? ''), label = String(element.text ?? href);
    content = /^https?:\/\//i.test(href) && element.unsafe !== true && style.unlink !== true ? <a href={href} target="_blank" rel="noreferrer">{label}</a> : label;
  } else {
    const fallback = blockText(element);
    return fallback ? textOf(ctx, fallback) : <span className="sc-content-unavailable">Message content unavailable in this mirror.</span>;
  }
  // source: https://docs.slack.dev/reference/block-kit/block-elements/text-element/ "An object of optional boolean properties that dictate style:"
  if (style.code === true) content = <code>{content}</code>;
  if (style.bold === true) content = <strong>{content}</strong>;
  if (style.italic === true) content = <em>{content}</em>;
  if (style.strike === true) content = <s>{content}</s>;
  if (style.underline === true) content = <u>{content}</u>;
  return content;
}

function bodyOf(ctx: HandlerContext, m: Row): ReactNode {
  const blocks = objects(m.blocks);
  if (!blocks.length) return textOf(ctx, String(m.text ?? ''));
  const textObject = (value: unknown): ReactNode => {
    if (!value || typeof value !== 'object') return null;
    const object = value as Row, text = String(object.text ?? '');
    return object.type === 'mrkdwn' ? mrkdwnOf(ctx, text) : text;
  };
  return blocks.map((block, i) => {
    // source: https://docs.slack.dev/reference/block-kit/blocks/section-block/ "2 columns of side-by-side text."
    if (block.type === 'section') return <div key={i}>{textObject(block.text)}{objects(block.fields).length ? <div className="sc-fields">{objects(block.fields).map((field, j) => <div key={j}>{textObject(field)}</div>)}</div> : null}{block.accessory ? <span className="sc-content-unavailable">Message control unavailable in this mirror.</span> : null}</div>;
    if (block.type === 'rich_text') return <div key={i}>{objects(block.elements).map((element, j) => <div key={j}>{richElement(ctx, element)}</div>)}</div>;
    if (block.type === 'divider') return <hr key={i}/>;
    const fallback = blockText(block);
    return <div key={i}>{fallback ? textOf(ctx, fallback) : <span className="sc-content-unavailable">Message content unavailable in this mirror.</span>}</div>;
  });
}

const CSS = `
.sc-inline-emoji{vertical-align:-3px}
.sc-avatar{flex:none;border-radius:4px;object-fit:cover}.sc-rail a{display:flex;align-items:center;flex-direction:column;gap:5px}.sc-reactions{display:flex;flex-wrap:wrap;gap:4px;margin:7px 0}.sc-reaction{display:inline-flex;align-items:center;gap:5px;border-radius:14px;background:#f0f0f0;padding:3px 8px;font-size:12px}.sc-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:5px 16px;margin-top:7px}.sc-text>div+div{margin-top:6px}.sc-text ul,.sc-text ol{margin:4px 0;padding-left:24px;white-space:normal}.sc-text li{white-space:pre-wrap}.sc-text pre{white-space:pre-wrap;background:#f8f8f8;border:1px solid #ddd;border-radius:4px;padding:8px}.sc-text code{background:#f8f8f8;border:1px solid #ddd;border-radius:3px;padding:0 3px}.sc-content-unavailable{display:block;color:#616061;font-size:12px;margin-top:4px}
*{box-sizing:border-box}body{margin:0;color:#1d1c1d;background:#4a154b;font:15px Lato,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}a{color:inherit}button,input,textarea,select{font:inherit}button,a,input,textarea,select,summary{outline-offset:3px}button{cursor:pointer}button:disabled{cursor:default}
.sc-top{height:44px;display:flex;align-items:center;justify-content:center;color:#fff;padding:0 20px;background:#350d36;font-size:14px}.sc-shell{display:flex;height:calc(100dvh - 44px);min-height:480px}.sc-rail{width:70px;flex:none;color:#fff;display:flex;align-items:center;flex-direction:column;padding:16px 6px;gap:20px}.sc-rail a{font-size:12px;text-decoration:none;padding:10px 5px;border-radius:8px;text-align:center}.sc-rail a[aria-current=page]{background:#ffffff25}.sc-sidebar{width:245px;flex:none;overflow:auto;background:#f0e9f1;color:#3f0e40;padding:20px 12px}.sc-workspace{margin:0 4px 24px;font-size:21px;font-weight:800;overflow-wrap:anywhere}.sc-sidebar h2{font-size:14px;margin:24px 12px 8px}.sc-sidebar ul{margin:0;padding:0;list-style:none}.sc-sidebar li a{display:block;border-radius:5px;text-decoration:none;padding:7px 12px;overflow-wrap:anywhere}.sc-sidebar li a[aria-current=page]{background:#8e5295;color:#fff}.sc-sidebar li a:hover{background:#e4d7e7}.sc-sidebar li a[aria-current=page]:hover{background:#8e5295}.sc-sidebar details{margin-top:18px}.sc-sidebar summary{cursor:pointer;padding:8px 12px;font-size:14px}.sc-person{font-size:12px;color:#616061;margin:28px 12px 0}.sc-conversation{display:flex;flex:1;min-width:0;flex-direction:column;background:#fff;border-radius:8px 0 0 0;overflow:hidden}.sc-header{padding:16px 22px 12px;border-bottom:1px solid #ddd}.sc-heading{display:flex;align-items:center;justify-content:space-between;gap:12px}.sc-heading h1{font-size:20px;margin:0;overflow-wrap:anywhere}.sc-count{color:#616061;font-size:13px;white-space:nowrap}.sc-topic{color:#616061;font-size:13px;margin:8px 0 0;overflow-wrap:anywhere}.sc-tabs{font-size:14px;font-weight:700;margin:16px 0 -12px}.sc-tabs span{display:inline-block;padding:0 4px 12px;border-bottom:2px solid #611f69}.sc-messages{overflow:auto;flex:1;padding:18px 0}.sc-message{padding:8px 22px;display:flex;gap:12px;position:relative}.sc-message:hover{background:#f8f8f8}.sc-message-body{min-width:0;flex:1}.sc-author{font-weight:700}.sc-time{font-size:12px;color:#616061;margin-left:8px;text-decoration:none}.sc-text{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.5;margin:3px 0}.sc-text a,.sc-replies{color:#1264a3}.sc-mention{background:#e8f5fa;color:#1264a3}.sc-bot{font-size:10px;color:#616061;background:#f0f0f0;border-radius:3px;padding:2px 4px;margin-left:5px}.sc-edited{font-size:12px;color:#616061;margin-left:6px}.sc-message-actions{margin-top:5px;display:flex;align-items:center;gap:16px;font-size:12px}.sc-replies{text-decoration:none;font-weight:700}.sc-reply-action{color:#616061;text-decoration:none}.sc-attachment{border-left:3px solid #ddd;padding-left:10px;margin:8px 0;font-size:14px}.sc-file{font-size:13px;color:#616061;margin:6px 0}.sc-composer{margin:12px 20px 20px;border:1px solid #aaa;border-radius:8px;overflow:hidden}.sc-composer label{display:block;font-size:13px;color:#616061;padding:10px 12px;background:#f8f8f8}.sc-composer textarea{width:100%;display:block;border:0;padding:12px;min-height:82px;resize:vertical;color:#1d1c1d;line-height:1.4}.sc-composer textarea:focus{outline:2px solid #1264a3;outline-offset:-2px}.sc-compose-bottom{display:flex;align-items:center;justify-content:space-between;padding:8px 10px;gap:10px}.sc-compose-bottom label{background:none;padding:0;color:#616061}.sc-send,.sc-join{border:0;background:#007a5a;color:#fff;border-radius:4px;padding:8px 14px;font-weight:700}.sc-composer button:disabled{opacity:.6}.sc-notice{padding:12px 20px;background:#f8f8f8;color:#616061;font-size:14px;border-top:1px solid #ddd}.sc-empty{padding:28px 22px;color:#616061;line-height:1.6}.sc-error{color:#b00020;padding:0 12px;white-space:pre-wrap;font-size:13px}.sc-thread{width:360px;flex:none;display:flex;flex-direction:column;background:#fff;border-left:1px solid #ddd;min-width:0}.sc-thread header{padding:18px 20px;border-bottom:1px solid #ddd;display:flex;justify-content:space-between;gap:16px}.sc-thread h2{font-size:18px;margin:0}.sc-thread header a{font-size:13px;color:#616061}.sc-thread .sc-message{padding:8px 16px}.sc-thread .sc-composer{margin:12px 16px 16px}.sc-thread-count{font-size:13px;color:#616061;margin:20px 16px 12px;border-bottom:1px solid #ddd;padding-bottom:12px}.sc-new-dm{padding:8px 12px}.sc-new-dm summary{padding:0}.sc-new-dm form{margin-top:12px}.sc-new-dm label{font-size:12px;display:block}.sc-new-dm select{display:block;max-width:100%;width:100%;margin:6px 0 10px;padding:6px}.sc-new-dm button{padding:6px 10px;background:#fff;border:1px solid #bbb;border-radius:4px;font-size:13px}.sc-noscript{padding:8px 20px;font-size:13px;background:#fff4d6}.sc-unread{font-size:11px;color:#616061}
.sc-day{text-align:center;color:#616061;font-size:12px;font-weight:700;border-top:1px solid #eee;padding:12px 0;margin:8px 20px}
@media(max-width:1000px){.sc-sidebar{width:205px}.sc-thread{width:310px}.sc-rail{width:56px}}@media(max-width:760px){.sc-shell{height:auto;min-height:calc(100dvh - 44px);flex-wrap:wrap}.sc-rail{display:none}.sc-sidebar{width:100%;padding:14px;max-height:210px}.sc-workspace{margin:0 0 12px}.sc-sidebar h2{margin:12px}.sc-sidebar ul{display:flex;flex-wrap:wrap}.sc-sidebar li a{padding:6px 10px}.sc-person{margin:10px 12px}.sc-conversation{min-height:560px;flex-basis:100%;border-radius:0}.sc-thread{width:100%;min-height:400px;border-top:1px solid #ddd}.sc-messages{max-height:60dvh}.sc-top{justify-content:flex-start}}
`;

// Submit only the visible form's published API call, then read the stored conversation again.
// A refusal keeps the draft and displays Slack's actual error. Network failures never show success.
const SCRIPT = `document.querySelectorAll('form[data-slack-api]').forEach(function(form) {
  var input = form.querySelector('textarea[name="text"]');
  if (input) input.addEventListener('keydown', function(event) {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault(); if (input.value.trim()) form.requestSubmit();
    }
  });
  form.addEventListener('submit', async function(event) {
    event.preventDefault();
    var button = form.querySelector('button[type="submit"]');
    var error = form.querySelector('[role="alert"]');
    var params = new URLSearchParams();
    new FormData(form).forEach(function(value, key) { params.append(key, String(value)); });
    if (button) button.disabled = true;
    if (error) error.textContent = '';
    try {
      var response = await fetch(form.action, {method:'POST', credentials:'same-origin', headers:{'content-type':'application/x-www-form-urlencoded'}, body:params.toString()});
      var answer = await response.json();
      if (!response.ok || answer.ok !== true) {
        if (error) error.textContent = String(answer.error || ('HTTP ' + response.status));
        return;
      }
      var destination = form.dataset.return;
      if (form.dataset.openDm) {
        if (!answer.channel || !answer.channel.id) throw new Error('Slack did not return a conversation');
        destination = form.dataset.openDm + encodeURIComponent(answer.channel.id);
      }
      window.location.assign(destination);
    } catch (failure) {
      if (error) error.textContent = 'Message was not confirmed: ' + String(failure.message || failure);
    } finally {
      if (button) button.disabled = false;
    }
  });
});`;

function composer(ctx: HandlerContext, c: Row, team: string, title: string, thread?: string) {
  const id = String(c.id), path = `${ctx.publicBase}${clientPath(team, id)}`;
  const textarea = thread ? 'thread-reply' : 'channel-message';
  return <form className="sc-composer" method="post" action={`${ctx.publicBase}/api/chat.postMessage`} data-slack-api="true" data-return={thread ? `${path}?thread_ts=${encodeURIComponent(thread)}` : path}>
    <input type="hidden" name="channel" value={id}/>
    {thread ? <input type="hidden" name="thread_ts" value={thread}/> : null}
    <label htmlFor={textarea}>{thread ? 'Reply' : 'Message'}</label>
    <textarea id={textarea} name="text" aria-label={thread ? 'Reply' : `Message ${title}`} placeholder={thread ? 'Reply…' : `Message ${title}`} required/>
    <p className="sc-error" role="alert" aria-live="polite"/>
    <div className="sc-compose-bottom">
      {thread ? <label><input type="checkbox" name="reply_broadcast" value="true"/> Also send to {c.is_im === true || c.is_mpim === true ? 'conversation' : 'channel'}</label> : <span/>}
      <button className="sc-send" type="submit" aria-label={thread ? 'Send reply' : 'Send now'}>Send now</button>
    </div>
  </form>;
}

function message(ctx: HandlerContext, m: Row, href: string, inThread = false) {
  const shown = messageView(ctx, m), person = ctx.get('user', String(m.user ?? ''));
  const name = String(m.username || nameOf(person, String(m.user ?? 'Unknown member')));
  const date = new Date(Number(m.ts) * 1000);
  const validTime = Number.isFinite(date.getTime());
  const attachments = Array.isArray(m.attachments) ? m.attachments as Row[] : [];
  const files = Array.isArray(m.files) ? m.files as Row[] : [];
  const reactions = objects(m.reactions);
  const bot = Boolean(m.bot_id) || person?.is_bot === true;
  const avatarId = String(m.user ?? m.bot_id ?? name);
  return <article className="sc-message" key={String(m.ts)} id={`message-${String(m.ts)}`}>
    <img className="sc-avatar" src={`https://brand.volter.ai/${bot ? 'bot' : 'runner'}/svg?seed=${encodeURIComponent(avatarId)}&size=36&radius=4`} width="36" height="36" alt=""/>
    <div className="sc-message-body">
      <span className="sc-author">{name}</span>{m.bot_id || person?.is_bot === true ? <span className="sc-bot">APP</span> : null}
      <time className="sc-time" title="UTC" dateTime={validTime ? date.toISOString() : undefined}>{validTime ? date.toLocaleTimeString('en-US', {hour:'numeric', minute:'2-digit', timeZone:'UTC'}) : String(m.ts)}</time>
      <div className="sc-text">{bodyOf(ctx, m)}{m.edited ? <span className="sc-edited">(edited)</span> : null}</div>
      {attachments.map((a, i) => <div className="sc-attachment" key={i}>{a.title ? <strong>{String(a.title)}</strong> : null}<p className="sc-text">{textOf(ctx, String(a.text || a.fallback || ''))}</p></div>)}
      {files.map((f, i) => <p className="sc-file" key={i}>File: {String(f.title || f.name || f.id)}</p>)}
      {reactions.length ? <div className="sc-reactions" aria-label="Reactions">{reactions.map((reaction, i) => <span className="sc-reaction" key={i} title={`${String(reaction.name ?? '')}: ${Number(reaction.count ?? 0)}`}><img src={`https://brand.volter.ai/emoji/${encodeURIComponent(String(reaction.name ?? ''))}/svg?size=16`} width="16" height="16" alt={String(reaction.name ?? '')}/>{Number(reaction.count ?? 0)}</span>)}</div> : null}
      {inThread ? null : <div className="sc-message-actions">
        {Number(shown.reply_count) > 0 ? <a className="sc-replies" href={href}>{String(shown.reply_count)} {Number(shown.reply_count) === 1 ? 'reply' : 'replies'}</a> : null}
        <a className="sc-reply-action" href={href} aria-label={`Reply in thread to ${name}'s message`}>Reply in thread</a>
      </div>}
    </div>
  </article>;
}

export async function screen(ctx: HandlerContext): Promise<Response> {
  if (ctx.call.request.method !== 'GET' && ctx.call.request.method !== 'HEAD') return refused(405, 'Method not allowed');
  const url = new URL(ctx.call.request.url), person = visitor(ctx);
  if (!person?.row) return refused(401, 'Sign in to Slack first', `${ctx.publicBase}/signin?next=${encodeURIComponent(url.pathname + url.search)}`);
  const identity = caller(ctx, `xoxp-${person.id}`);
  if ('error' in identity) return refused(401, identity.error);
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'client' || parts.length > 3) return refused(404, 'Page not found');
  let team: string, named: string | undefined;
  try {
    team = parts[1] ? decodeURIComponent(parts[1]) : identity.team;
    named = parts[2] ? decodeURIComponent(parts[2]) : undefined;
  } catch { return refused(404, 'Page not found'); }
  if (!ctx.get('team', team) || !teamsOf(ctx, person.id).includes(team)) return refused(404, 'Workspace not found');
  const by: Caller = {...identity, team};
  const all = ctx.rows('channel').filter((c) => channelTeam(c) === team && sees(ctx, c, by));
  const joined = all.filter((c) => channelMembers(ctx, String(c.id)).includes(person.id));
  const channels = joined.filter((c) => c.is_im !== true && c.is_mpim !== true).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const dms = joined.filter((c) => c.is_im === true || c.is_mpim === true);
  const selected = named ? all.find((c) => c.id === named) : channels.find((c) => c.is_general === true) ?? channels[0] ?? dms[0];
  if (!named && selected) return seeOther(`${ctx.publicBase}${clientPath(team, String(selected.id))}`);
  const workspace = String(ctx.get('team', team)?.name ?? 'Slack');
  const thread = url.searchParams.get('thread_ts') ?? undefined;
  const held = selected && thread ? ctx.get('message', messageId(String(selected.id), thread)) : undefined;
  const rootTs = held ? String(held.thread_ts || held.ts) : undefined;
  const root = selected && rootTs ? ctx.get('message', messageId(String(selected.id), rootTs)) : undefined;
  const missingThread = Boolean(thread && (!root || root.deleted === true));
  const member = selected && channelMembers(ctx, String(selected.id)).includes(person.id);
  const archived = selected?.is_archived === true;
  const title = selected ? symbolOf(selected) + conversationName(ctx, selected, by) : workspace;
  const path = `${ctx.publicBase}${clientPath(team, selected ? String(selected.id) : undefined)}`;
  const history = selected ? messagesIn(ctx, String(selected.id)).sort((a, b) => Number(a.ts) - Number(b.ts)) : [];
  const top = history.filter((m) => !m.thread_ts || m.thread_ts === m.ts || m.subtype === 'thread_broadcast');
  const replies = rootTs ? history.filter((m) => m.thread_ts === rootTs && m.ts !== rootTs) : [];
  const people = ctx.rows('user').filter((u) => u.deleted !== true && u.id !== person.id && teamsOf(ctx, String(u.id)).includes(team));
  const nav = (items: Row[]) => <ul>{items.map((c) => <li key={String(c.id)}><a href={`${ctx.publicBase}${clientPath(team, String(c.id))}`} aria-current={c.id === selected?.id ? 'page' : undefined}>{symbolOf(c)}{conversationName(ctx, c, by)}{c.is_archived === true ? ' (archived)' : ''}</a></li>)}</ul>;
  return flowPage({title:`${title} | ${workspace} | Slack`, css:[CSS], status:named && !selected || missingThread ? 404 : 200, body:<>
    <div className="sc-top">{workspace}</div>
    <main className="sc-shell" aria-label="Slack workspace">
      <nav className="sc-rail" aria-label="Slack"><a href={`${ctx.publicBase}${clientPath(team)}`} aria-current="page">{icon('house', 22)}Home</a><a href="#direct-messages">{icon('messages-square', 22)}DMs</a></nav>
      <aside className="sc-sidebar" aria-label="Conversations">
        <h2 className="sc-workspace">{workspace}</h2>
        <h2>Channels</h2>{nav(channels)}
        <h2 id="direct-messages">Direct messages</h2>{nav(dms)}
        <details className="sc-new-dm"><summary>New message</summary><form method="post" action={`${ctx.publicBase}/api/conversations.open`} data-slack-api="true" data-open-dm={`${ctx.publicBase}${clientPath(team)}/`}>
          <label htmlFor="dm-person">To</label><select id="dm-person" name="users" required><option value="">Choose a person</option>{people.map((u) => <option key={String(u.id)} value={String(u.id)}>{nameOf(u)}</option>)}</select>
          <p className="sc-error" role="alert" aria-live="polite"/><button type="submit">Open conversation</button>
        </form></details>
        <details><summary>Browse channels</summary>{nav(all.filter((c) => c.is_im !== true && c.is_mpim !== true && !channelMembers(ctx, String(c.id)).includes(person.id)))}</details>
        <p className="sc-person">{nameOf(person.row)}<br/><a href={`${ctx.publicBase}/account/notifications`}>Preferences</a></p>
      </aside>
      <section className="sc-conversation" aria-label={selected ? title : 'Conversation'}>
        <header className="sc-header"><div className="sc-heading"><h1>{title}</h1>{selected ? <span className="sc-count">{channelMembers(ctx, String(selected.id)).length} members</span> : null}</div>
          {selected && (selected.topic as Row | undefined)?.value ? <p className="sc-topic">{String((selected.topic as Row).value)}</p> : null}<div className="sc-tabs"><span>Messages</span></div>
        </header>
        {named && !selected ? <p className="sc-empty" role="alert">channel_not_found — This conversation is unavailable.</p> : null}
        {missingThread ? <p className="sc-notice" role="alert">thread_not_found — This thread is unavailable.</p> : null}
        <div className="sc-messages" aria-label="Messages">{top.map((m, i) => {
          const date = new Date(Number(m.ts) * 1000), previous = i ? new Date(Number(top[i - 1]!.ts) * 1000) : undefined;
          const day = Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : '';
          const first = day && (!previous || !Number.isFinite(previous.getTime()) || previous.toISOString().slice(0, 10) !== day);
          return <div key={String(m.ts)}>{first ? <p className="sc-day">{date.toLocaleDateString('en-US', {month:'long', day:'numeric', year:'numeric', timeZone:'UTC'})}</p> : null}{message(ctx, m, `${path}?thread_ts=${encodeURIComponent(String(m.thread_ts || m.ts))}`)}</div>;
        })}{selected && top.length === 0 ? <p className="sc-empty">This is the beginning of your conversation in {title}.</p> : null}{!selected && !named ? <p className="sc-empty">Choose a channel or start a direct message.</p> : null}</div>
        {selected ? archived ? <p className="sc-notice">This channel is archived. You can read its messages, but you cannot send new messages.</p> : !member ? <div className="sc-notice"><p>Join this channel to send messages.</p><form method="post" action={`${ctx.publicBase}/api/conversations.join`} data-slack-api="true" data-return={path}><input type="hidden" name="channel" value={String(selected.id)}/><p className="sc-error" role="alert" aria-live="polite"/><button className="sc-join" type="submit">Join Channel</button></form></div> : composer(ctx, selected, team, title) : null}
      </section>
      {selected && root && !missingThread ? <aside className="sc-thread" aria-label="Thread">
        <header><h2>Thread</h2><a href={path} aria-label="Close thread">Close</a></header>
        <div className="sc-messages" aria-label="Thread messages">{message(ctx, root, '', true)}<p className="sc-thread-count">{replies.length} {replies.length === 1 ? 'reply' : 'replies'}</p>{replies.map((m) => message(ctx, m, '', true))}</div>
        {archived ? <p className="sc-notice">This channel is archived.</p> : member ? composer(ctx, selected, team, title, rootTs) : <p className="sc-notice">Join this channel to reply.</p>}
      </aside> : null}
    </main>
    <noscript><p className="sc-noscript">Enable JavaScript to return to the conversation after sending.</p></noscript>
    <script dangerouslySetInnerHTML={{__html:SCRIPT}}/>
  </>});
}
