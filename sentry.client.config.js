// sentry.client.config.js
// Sentry (ধাপ ৮) — শুধু ব্রাউজার/অ্যাপের WebView। DSN: env PUBLIC_SENTRY_DSN (না থাকলে কিছুই হয় না)।
//
// নকশা:
//   • লাইব্রেরি LAZY: পেজ লোডে কিছুই ডাউনলোড হয় না; প্রথম এরর (বা টেস্ট) এলে তখন লোড + init হয়।
//   • Replay, Tracing, সেশন-ট্র্যাকিং, ব্রেডক্রাম্ব সব বন্ধ — শুধু এরর ইভেন্ট।
//   • Sentry-র নিজস্ব GlobalHandlers বন্ধ: এরর যায় src/lib/errorReporter.js থেকে (ফিল্টার + ডেডুপ
//     + পেজ-প্রতি সর্বোচ্চ ১০), তাই ইভেন্ট আইডি app_error_logs-এর সাথে নিশ্চিতভাবে মেলে।
//   • ব্যক্তিগত তথ্য: sendDefaultPii বন্ধ, ইমেইল/ফোন/JWT মাস্ক, URL-এর query/hash কাটা, কুকি/ইউজার বাদ।
//   • টেস্ট: যেকোনো পেজের URL-এ ?sf_sentry_test=1 দিলে একটা টেস্ট ইভেন্ট যায় (যাচাই শেষে বাদ দেওয়া হবে)।

const DROP_INTEGRATIONS = [
  'BrowserTracing',
  'BrowserSession',
  'GlobalHandlers',
  'Breadcrumbs',
  'Replay',
  'Feedback',
  'Spotlight',
];

function clean(value) {
  let m = String(value == null ? '' : value);
  m = m.replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[token]');
  m = m.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]');
  m = m.replace(/(?:\+?88)?01[3-9]\d{8}/g, '[phone]');
  return m;
}

function stripQuery(url) {
  return String(url || '').replace(/[?#].*$/, '');
}

function detectEnvironment() {
  try {
    const h = location.hostname || '';
    if (h === 'smartfeni.com' || h === 'www.smartfeni.com') return 'production';
    if (h === 'localhost' || h === '127.0.0.1') return 'app'; // Capacitor অ্যাপ (WebView)
    return 'preview';
  } catch (_) {
    return 'unknown';
  }
}

const dsn = import.meta.env.PUBLIC_SENTRY_DSN;

if (typeof window !== 'undefined' && dsn && !import.meta.env.DEV) {
  let ready = null;

  // প্রথমবার ডাকলে লাইব্রেরি লোড + init; পরেরবার একই প্রতিশ্রুতি
  const load = () => {
    if (!ready) {
      ready = import('@sentry/astro').then(({ init, captureException, captureMessage }) => {
        init({
          dsn,
          environment: detectEnvironment(),
          sendDefaultPii: false,
          sampleRate: 1,
          maxBreadcrumbs: 0,
          integrations: (defaults) => defaults.filter((i) => !DROP_INTEGRATIONS.includes(i.name)),
          denyUrls: [/^chrome:\/\//i, /^chrome-extension:\/\//i, /^moz-extension:\/\//i, /^safari-(web-)?extension:\/\//i],
          beforeSend(event) {
            try {
              if (event.message) event.message = clean(event.message);
              const values = (event.exception && event.exception.values) || [];
              for (const ex of values) {
                if (ex && ex.value) ex.value = clean(ex.value);
              }
              if (event.request) {
                event.request.url = stripQuery(event.request.url);
                delete event.request.query_string;
                delete event.request.cookies;
                const ua = event.request.headers && (event.request.headers['User-Agent'] || event.request.headers['user-agent']);
                event.request.headers = ua ? { 'User-Agent': ua } : undefined;
              }
              event.user = undefined;
            } catch (_) {}
            return event;
          },
        });
        return { captureException, captureMessage };
      });
    }
    return ready;
  };

  // errorReporter.js এই হুক দিয়ে এরর পাঠায় ও ইভেন্ট আইডি পায়
  window.__sfSentryCapture = async (err, action) => {
    try {
      const s = await load();
      return s.captureException(err, { tags: { sf_action: action || '' } });
    } catch (_) {
      return null;
    }
  };

  try {
    if (location.search.indexOf('sf_sentry_test=1') !== -1) {
      load()
        .then((s) => s.captureMessage('SF Sentry test event (শুধু যাচাইয়ের জন্য)', 'info'))
        .catch(() => {});
    }
  } catch (_) {}
}
