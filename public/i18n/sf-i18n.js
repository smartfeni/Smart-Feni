/* Smart Feni ভাষা ইঞ্জিন (বাংলা → English)
 * English মোডে পেজের বাংলা লেখা ডিকশনারি (/i18n/en.js → window.SF_I18N_EN) দেখে বদলায়।
 * JS দিয়ে পরে আসা কার্ড/টোস্টও MutationObserver দিয়ে ধরা হয়।
 * ইনপুট/টেক্সটএরিয়ার লেখা, [data-no-i18n] এর ভেতরের কিছু ছোঁয় না।
 * নতুন UI লেখা যোগ করলে public/i18n/en.js-এ লাইন যোগ করতে হবে। */
(function () {
  'use strict';
  var root = document.documentElement;
  var D = window.SF_I18N_EN || {};
  var BN = /[ঀ-৿]/;
  var DIG = '০১২৩৪৫৬৭৮৯';
  var SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, NOSCRIPT: 1, CODE: 1, PRE: 1, svg: 1, SVG: 1 };
  var ATTRS = ['placeholder', 'title', 'aria-label', 'data-tooltip'];
  var cache = Object.create(null);
  var tplHit = false; // টেমপ্লেট মিলেছে (ভেতরে ইউজারের বাংলা নাম থাকতে পারে)

  function norm(s) { return s.replace(/\s+/g, ' ').trim(); }
  function digits(s) { return s.replace(/[০-৯]/g, function (c) { return String(DIG.indexOf(c)); }); }
  function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // ডিকশনারির key-গুলো নরমালাইজ
  var DN = Object.create(null);
  Object.keys(D).forEach(function (k) { DN[norm(k)] = D[k]; });
  // {} থাকা key = টেমপ্লেট (JS-এ জোড়া লাগানো লেখা)
  var TPL = [];
  Object.keys(DN).forEach(function (k) {
    if (k.indexOf('{}') === -1) return;
    var lit = k.split('{}').join('').replace(/[^\u0980-\u09E5\u09F0-\u09F2\u09F4-\u09FF]/g, '').length;
    try { TPL.push([new RegExp('^' + k.split('{}').map(esc).join('(.+?)') + '$'), DN[k], lit]); } catch (e) {}
    delete DN[k];
  });
  TPL.sort(function (a, b) { return b[0].source.length - a[0].source.length; });
  var BNL = /[\u0980-\u09E5\u09F0-\u09F2\u09F4-\u09FF]/;

  var TW = { 'সকাল': 'am', 'ভোর': 'am', 'দুপুর': 'pm', 'বিকেল': 'pm', 'সন্ধ্যা': 'pm', 'রাত': 'night' };
  function ampm(word, hh) {
    var t = TW[word];
    if (t === 'night') { var h = parseInt(digits(hh), 10); return h >= 5 && h <= 11 ? 'pm' : 'am'; }
    return t || '';
  }

  function core(s) {
    if (DN[s] !== undefined) return DN[s];
    for (var i = 0; i < TPL.length; i++) {
      var tm = s.match(TPL[i][0]);
      if (tm && TPL[i][2] < 8 && tm.slice(1).some(function (g) { return BNL.test(g || ''); })) continue; // ছোট টেমপ্লেটে বাংলা শব্দ ধরবে না
      if (tm) { tplHit = true; var k = 1, val = TPL[i][1]; return val.replace(/\{\}/g, function () { var g = tm[k++] || ''; if (!BNL.test(g)) return g; var c = core(norm(g)); return (k > 2 || val.indexOf('{}') > 0) && /^[A-Z][a-z]+$/.test(c) ? c.toLowerCase() : c; }); }
    }
    // কয়েকটা বাক্য/অংশ জোড়া থাকলে আলাদা করে অনুবাদ
    var marked = s.replace(/([।!?])\s+/g, '$1\u0001').replace(/\s+·\s+/g, '\u0002');
    if (marked !== s) {
      var parts = marked.split(/[\u0001\u0002]/), seps = marked.match(/[\u0001\u0002]/g) || [];
      var done = parts.map(function (p) { return core(norm(p)); });
      if (!done.some(function (p) { return BNL.test(p); })) return done.map(function (p, i) { return p + (i < seps.length ? (seps[i] === '\u0002' ? ' · ' : ' ') : ''); }).join('');
    }
    var x = s;
    // সময়: "রাত ১০:৩০" / "১০:৩০ রাত"
    x = x.replace(/(সকাল|ভোর|দুপুর|বিকেল|সন্ধ্যা|রাত)\s*([০-৯\d]{1,2})(:[০-৯\d]{2})?(\s*টা)?/g, function (m, w, h, mm) { return h + (mm || '') + ' ' + ampm(w, h); });
    x = x.replace(/([০-৯\d]{1,2})(:[০-৯\d]{2})?\s*(?:টা\s*)?(সকাল|ভোর|দুপুর|বিকেল|সন্ধ্যা|রাত)(?![ঀ-৿])/g, function (m, h, mm, w) { return h + (mm || '') + ' ' + ampm(w, h); });
    // সংখ্যা + বাকি অংশ (যেমন "৫টি দোকান")
    var m = x.match(/^([৳$]?\s*[০-৯\d][০-৯\d,.:]*\s*[%+]?)\s*(.+)$/);
    if (m && BNL.test(m[2]) && DN[norm(m[2])] !== undefined) { var v = DN[norm(m[2])]; return m[1] + (/^[\s%),.]/.test(v) ? '' : ' ') + v; }
    m = x.match(/^(.+?)\s*([৳$]?\s*[০-৯\d][০-৯\d,.:]*)$/);
    if (m && BNL.test(m[1]) && DN[norm(m[1])] !== undefined) return DN[norm(m[1])] + ' ' + m[2];
    // সংখ্যার পরে টা/টি
    x = x.replace(/([০-৯\d])\s*(টা|টি|জন)(?![ঀ-৿])/g, '$1');
    // আংশিক শব্দ বদলে মিশ্র লেখা বানানো হয় না; না মিললে পুরো বাংলাই থাকে (ডিকশনারিতে যোগ করতে হবে)
    if (BNL.test(x)) return s;
    return x;
  }

  function tr(s) {
    if (!s || !BN.test(s)) return s;
    var hit = cache[s];
    if (hit !== undefined) return hit;
    var lead = (s.match(/^\s*/) || [''])[0], trail = (s.match(/\s*$/) || [''])[0];
    tplHit = false;
    var out = core(norm(s));
    if (BNL.test(out) && !tplHit) { cache[s] = s; return s; } // অনুবাদ নেই: যেমন আছে তেমন
    out = digits(out).replace(/।/g, '.').replace(/\s{2,}/g, ' ').replace(/\s+([,.!?:)%])/g, '$1').replace(/\(\s+/g, '(');
    out = lead + out.trim() + trail;
    cache[s] = out;
    return out;
  }

  function skipEl(el) {
    for (var e = el; e && e !== document.body; e = e.parentNode) {
      if (e.nodeType !== 1) continue;
      if (SKIP[e.nodeName] || e.isContentEditable) return true;
      if (e.hasAttribute && e.hasAttribute('data-no-i18n')) return true;
    }
    return false;
  }

  function doText(n) {
    var v = n.nodeValue;
    if (!v || !BN.test(v)) return;
    if (skipEl(n.parentNode)) return;
    var o = tr(v);
    if (o !== v) n.nodeValue = o;
  }
  function doAttrs(el) {
    for (var i = 0; i < ATTRS.length; i++) {
      var a = el.getAttribute(ATTRS[i]);
      if (a && BN.test(a)) { var o = tr(a); if (o !== a) el.setAttribute(ATTRS[i], o); }
    }
    if (el.nodeName === 'INPUT' && (el.type === 'button' || el.type === 'submit') && BN.test(el.value)) { var bv = tr(el.value); if (bv !== el.value) el.value = bv; }
    if (el.nodeName === 'OPTION' || el.nodeName === 'OPTGROUP') { var l = el.getAttribute('label'); if (l && BN.test(l)) { var lo = tr(l); if (lo !== l) el.setAttribute('label', lo); } }
  }
  function walk(node) {
    if (!node) return;
    if (node.nodeType === 3) { doText(node); return; }
    if (node.nodeType !== 1 && node.nodeType !== 11) return;
    if (node.nodeType === 1) {
      if (node.nodeName === 'TEXTAREA') { doAttrs(node); return; }
      if (SKIP[node.nodeName] || (node.hasAttribute && node.hasAttribute('data-no-i18n'))) return;
      doAttrs(node);
    }
    var w = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (n.nodeType === 1 && n.nodeName === 'TEXTAREA' && !n.hasAttribute('data-no-i18n')) { doAttrs(n); return NodeFilter.FILTER_REJECT; }
        if (n.nodeType === 1 && (SKIP[n.nodeName] || n.hasAttribute('data-no-i18n') || n.isContentEditable)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var n;
    while ((n = w.nextNode())) {
      if (n.nodeType === 3) { var v = n.nodeValue; if (v && BN.test(v)) { var o = tr(v); if (o !== v) n.nodeValue = o; } }
      else doAttrs(n);
    }
  }

  // শুধু বদলালে লিখি — একই মান আবার বসালে <title>-এর অবজারভার নিজেকে বারবার চালিয়ে পেজ আটকে দিত
  function title() { var t = document.title; if (!BN.test(t)) return; var o = tr(t); if (o !== t) document.title = o; }

  var queue = [], pending = false, obs = null, burst = 0, burstT = 0;
  function flush() {
    pending = false;
    // নিরাপত্তা: পেজের কোনো স্ক্রিপ্টের সাথে লুপ হলে (সেকেন্ডে ৬০+ বার) অনুবাদ থামিয়ে পেজ চালু রাখি
    var now = Date.now();
    if (now - burstT > 1000) { burstT = now; burst = 0; }
    if (++burst > 60) { try { obs && obs.disconnect(); } catch (e) {} queue = []; return; }
    var q = queue; queue = [];
    for (var i = 0; i < q.length; i++) {
      var r = q[i];
      if (r.type === 'childList') { if (skipEl(r.target)) continue; for (var j = 0; j < r.addedNodes.length; j++) walk(r.addedNodes[j]); }
      else if (r.type === 'characterData') doText(r.target);
      else if (r.type === 'attributes') { if (!skipEl(r.target)) doAttrs(r.target); }
    }
    title();
  }

  function start() {
    try {
      walk(document.body);
      title();
      obs = new MutationObserver(function (list) {
        for (var i = 0; i < list.length; i++) queue.push(list[i]);
        if (!pending) { pending = true; Promise.resolve().then(flush); }
      }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS.concat(['value', 'label']) });
      var t = document.querySelector('title');
      if (t) new MutationObserver(title).observe(t, { childList: true, characterData: true, subtree: true });
    } catch (e) { /* ইঞ্জিন ব্যর্থ হলেও পেজ দেখাবে */ }
    root.classList.remove('sf-i18n-wait');
  }

  // alert/confirm/prompt-এর বার্তাও অনুবাদ
  ['alert', 'confirm', 'prompt'].forEach(function (k) {
    var f = window[k];
    if (typeof f !== 'function') return;
    window[k] = function (msg) { var a = Array.prototype.slice.call(arguments); if (typeof msg === 'string') a[0] = tr(msg); return f.apply(window, a); };
  });

  window.SFT = tr;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
