// Stripe.js 7.3.1 is Dub’s pinned browser SDK (apps/web/package.json:49 and pnpm-lock.yaml).
// Its loader requests a release-train script, reads window.Stripe and registers its wrapper.
// The shipped upgrade button calls redirectToCheckout({ sessionId }); hosted-checkout.d.ts declares that
// navigation and its promise that settles only on failure. Other SDK flows have no demanded caller.
import type { HandlerContext } from '@volter/world-core';
import { notFound } from './shared.tsx';

/** The release train a script path names: `/v3`, `/v3/` or `/v3/stripe.js` → 3, `/<train>/stripe.js` → the train. */
function stripeJsTrain(pathname: string): 3 | string | undefined {
  return /^\/v3(\/|\/stripe\.js)?$/.test(pathname) ? 3 : /^\/([a-z]+)\/stripe\.js$/.exec(pathname)?.[1];
}

// source: archive:https://registry.npmjs.org/@stripe/stripe-js/-/stripe-js-8.6.0.tgz#sha256=13e61419e9076ab440cc636e34d3ea5df3fc62bbf2d6a80d3fd718e8cd47f0a2!/package/dist/stripe-js/checkout.d.ts "loadActions: () => Promise<StripeCheckoutLoadActionsResult>"
function script(version: 3 | string): string {
  return `(function () {
  var version = ${JSON.stringify(version)};
  function gap(name) {
    return function () { throw new Error("Stripe.js (Volter twin): stripe." + name + " is not modelled by this twin yet"); };
  }
  function initCheckout(options) {
    var session, root, fields = {}, listeners = {};
    function emit(name, value) { (listeners[name] || []).forEach(function (fn) { fn(value); }); }
    function call(action, values) {
      var secret = options.clientSecret;
      var id = secret.split("_secret_")[0];
      return fetch("https://api.stripe.com/v1/payment_pages/" + encodeURIComponent(id) + "/" + action, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(Object.assign({ client_secret: secret }, values || {}))
      }).then(function (r) { return r.json(); }).then(function (result) {
        if (result.type === "success") { session = result.session; emit("change", session); }
        return result;
      });
    }
    var actions = {
      getSession: function () { return session; },
      applyPromotionCode: function (code) { return call("apply_promotion_code", { promotion_code: code }); },
      removePromotionCode: function () { return call("remove_promotion_code"); },
      confirm: function (params) {
        return call("confirm", Object.assign({}, params || {}, { payment_details: fields })).then(function (result) {
          if (result.type === "success" && (!params || params.redirect !== "if_required") && result.return_url) window.location.assign((params && params.returnUrl) || result.return_url);
          return result;
        });
      }
    };
    var elementListeners = {};
    function elementEmit(name, value) { (elementListeners[name] || []).forEach(function (fn) { fn(value); }); }
    var element = {
      on: function (name, fn) { (elementListeners[name] || (elementListeners[name] = [])).push(fn); return element; },
      off: function (name, fn) { elementListeners[name] = (elementListeners[name] || []).filter(function (f) { return f !== fn; }); return element; },
      mount: function (target) {
        root = typeof target === "string" ? document.querySelector(target) : target;
        [["cardNumber", "Card number", "cc-number"], ["cardExpiry", "Expiration", "cc-exp"], ["cardCvc", "CVC", "cc-csc"], ["billingName", "Cardholder name", "cc-name"]].forEach(function (field) {
          var label = document.createElement("label"), input = document.createElement("input");
          label.textContent = field[1]; input.name = field[0]; input.autocomplete = field[2];
          input.addEventListener("input", function () { fields[field[0]] = input.value; elementEmit("change", { empty: !fields.cardNumber, complete: !!(fields.cardNumber && fields.cardExpiry && fields.cardCvc), value: { type: "card" } }); });
          label.appendChild(input); root.appendChild(label);
        });
        Promise.resolve().then(function () { elementEmit("ready", element); });
      },
      unmount: function () { if (root) root.replaceChildren(); root = null; },
      destroy: function () { element.unmount(); elementListeners = {}; },
      update: function () {}
    };
    return {
      on: function (name, fn) { (listeners[name] || (listeners[name] = [])).push(fn); },
      loadActions: function () { return call("init").then(function (r) { return r.type === "success" ? { type: "success", actions: actions } : r; }); },
      createPaymentElement: function () { return element; }, getPaymentElement: function () { return element; },
      changeAppearance: function () {}, loadFonts: function () {}
    };
  }
  function Stripe(publishableKey) {
    if (typeof publishableKey !== "string" || !publishableKey) throw new Error("Stripe.js (Volter twin): Stripe() needs a publishable key");
    var known = {
      initCheckout: initCheckout,
      _registerWrapper: function () {},
      redirectToCheckout: function (options) {
        if (!options || typeof options.sessionId !== "string" || !options.sessionId) return gap("redirectToCheckout without a sessionId")();
        window.location.assign("https://checkout.stripe.com/c/pay/" + encodeURIComponent(options.sessionId));
        return new Promise(function () {});
      }
    };
    return new Proxy(known, {
      get: function (target, name) {
        if (name in target) return target[name];
        if (typeof name === "symbol" || name === "then") return undefined;
        return gap(String(name));
      }
    });
  }
  Stripe.version = version;
  window.Stripe = Stripe;
})();
`;
}

/** js.stripe.com's script for a GET of its path; Stripe's 404 for anything else there. */
export async function screen(ctx: HandlerContext): Promise<Response> {
  const request = ctx.call.request;
  const train = request.method === 'GET' || request.method === 'HEAD' ? stripeJsTrain(new URL(request.url).pathname) : undefined;
  if (train === undefined) return notFound();
  return new Response(script(train), { headers: { 'content-type': 'application/javascript; charset=utf-8', 'access-control-allow-origin': '*' } });
}
