// Turnstile's api.js, challenges.cloudflare.com/turnstile/v0/api.js: the script a site loads to put the widget on its
// pages (implicitly on each .cf-turnstile element, or explicitly with ?render=explicit and turnstile.render), as
// react-turnstile and @marsidev/react-turnstile load it. Each widget is a frame of the `turnstile-challenge` screen on
// the script's own origin; the token it posts back fills the page's cf-turnstile-response input and the callback.
import type { HandlerContext } from '@volter/world-core';

// source: https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/ "An invisible input with the name cf-turnstile-response is added and will be sent to the server with the other fields."
const SCRIPT = String.raw`(function () {
  if (window.turnstile) return;
  var current = document.currentScript;
  var src = new URL(current && current.src ? current.src : location.href);
  var origin = src.origin;
  var widgets = {}; var count = 0; var readies = [];
  function element(target) { return typeof target === 'string' ? document.querySelector(target) : target; }
  function find(ref) { if (ref === undefined) { for (var k in widgets) return widgets[k]; return undefined; } if (widgets[ref]) return widgets[ref]; var el = element(ref); for (var k2 in widgets) if (widgets[k2].container === el) return widgets[k2]; return undefined; }
  function call(fn, arg) { var f = typeof fn === 'string' ? window[fn] : fn; if (typeof f === 'function') f(arg); }
  function frame(w) {
    var q = new URLSearchParams({ sitekey: w.params.sitekey || '', hostname: location.hostname, id: w.id, action: w.params.action || '', cdata: w.params.cData || w.params.cdata || '' });
    var iframe = document.createElement('iframe');
    iframe.src = origin + '/turnstile/v0/challenge?' + q.toString();
    iframe.title = 'Widget containing a Cloudflare security challenge';
    iframe.style.cssText = 'border:none;width:300px;height:65px';
    if (w.iframe) w.iframe.remove();
    w.iframe = iframe; w.container.appendChild(iframe);
  }
  function input(w) {
    var name = w.params['response-field-name'] || 'cf-turnstile-response';
    if (w.params['response-field'] === false) return undefined;
    var el = w.container.querySelector('input[name="' + name + '"]');
    if (!el) { el = document.createElement('input'); el.type = 'hidden'; el.name = name; w.container.appendChild(el); }
    return el;
  }
  window.addEventListener('message', function (e) {
    if (e.origin !== origin || !e.data || e.data.source !== 'cloudflare-challenge') return;
    var w = widgets[e.data.id]; if (!w) return;
    if (e.data.event === 'complete') {
      w.token = e.data.token; w.expired = false; var el = input(w); if (el) el.value = w.token;
      clearTimeout(w.timer);
      w.timer = setTimeout(function () { w.expired = true; w.token = undefined; var i = input(w); if (i) i.value = ''; call(w.params['expired-callback']); }, 300000);
      call(w.params.callback, w.token);
    } else if (e.data.event === 'error') call(w.params['error-callback'], e.data.code);
  });
  var api = {
    render: function (target, params) {
      var container = element(target); if (!container) throw new Error('turnstile: no container ' + target);
      params = params || {};
      var d = container.dataset || {};
      var merged = { sitekey: params.sitekey || d.sitekey, action: params.action || d.action, cData: params.cData || d.cdata, callback: params.callback || d.callback,
        'error-callback': params['error-callback'] || d.errorCallback, 'expired-callback': params['expired-callback'] || d.expiredCallback,
        execution: params.execution || d.execution || 'render', 'response-field': params['response-field'], 'response-field-name': params['response-field-name'] || d.responseFieldName };
      var id = 'cf-chl-widget-' + (++count);
      var w = { id: id, container: container, params: merged, token: undefined, expired: false };
      widgets[id] = w;
      if (merged.execution !== 'execute') frame(w);
      return id;
    },
    execute: function (ref, params) { var w = find(ref); if (!w && ref) { api.render(ref, Object.assign({}, params || {}, { execution: 'render' })); return; } if (w) frame(w); },
    reset: function (ref) { var w = find(ref); if (!w) return; clearTimeout(w.timer); w.token = undefined; w.expired = false; var el = input(w); if (el) el.value = ''; frame(w); },
    remove: function (ref) { var w = find(ref); if (!w) return; clearTimeout(w.timer); if (w.iframe) w.iframe.remove(); delete widgets[w.id]; },
    getResponse: function (ref) { var w = find(ref); return w ? w.token : undefined; },
    isExpired: function (ref) { var w = find(ref); return w ? w.expired : false; },
    ready: function (cb) { if (document.readyState === 'loading') readies.push(cb); else cb(); },
  };
  window.turnstile = api;
  function implicit() { var els = document.querySelectorAll('.cf-turnstile'); for (var i = 0; i < els.length; i++) if (!els[i].querySelector('iframe')) api.render(els[i]); }
  function loaded() {
    for (var i = 0; i < readies.length; i++) readies[i]();
    if (src.searchParams.get('render') !== 'explicit') implicit();
    var onload = src.searchParams.get('onload'); if (onload && typeof window[onload] === 'function') window[onload]();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loaded); else loaded();
})();
`;

// source: https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/ "Call turnstile.render() when you are ready to create the widget."
export async function screen(_ctx: HandlerContext): Promise<Response> {
  return new Response(SCRIPT, { headers: { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'no-cache' } });
}
