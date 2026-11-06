package com.smartfeni.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.webkit.WebView;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

/**
 * SFHealth — অ্যাপ খোলা ও পেজ লোডের স্বাস্থ্য নেটিভ দিক থেকে নজরে রাখে।
 *
 * কেন নেটিভ: পেজ যদি কখনো লোডই না হয় (কালো স্ক্রিনে আটকে থাকা), ওয়েবের JS চলে না, তাই ওয়েব থেকে
 * কোনো রিপোর্টও আসে না। নেটিভ অংশ চলে অ্যাপ চালু হওয়া মাত্র, তাই এটাই একমাত্র জায়গা যেখান থেকে
 * "অ্যাপ খুলল কিন্তু পেজ আসেনি" ধরা যায়।
 *
 *  • load()       → অ্যাপ চালু: `app_open` ইভেন্ট পাঠায় এবং ১৫ সেকেন্ডের watchdog চালু করে।
 *  • ready()      → ওয়েবের healthTracker.js পেজ ব্যবহারযোগ্য হলে ডাকে → watchdog বন্ধ।
 *  • errorShown() → www/error.html দেখা গেলে ডাকে (error.html নিজে রিপোর্ট করে, তাই watchdog বন্ধ)।
 *  • watchdog     → ১৫ সেকেন্ডেও ready()/errorShown() না এলে `native_watchdog` ইভেন্ট (কানেকশন, Private DNS,
 *                   অটো-টাইম, ডেটা সেভার সহ)।
 *  • report()     → error.html/ওয়েব থেকে নেটিভ কিউয়ের মাধ্যমে ইভেন্ট (প্রসেস মরলেও হারায় না)।
 *  • getInfo()    → ওয়েব ট্র্যাকারের জন্য সঠিক ফোন মডেল/OS/WebView/অ্যাপ ভার্সন/কানেকশন।
 *
 * পাঠানো ব্যর্থ হলে SharedPreferences-এ (সর্বোচ্চ ১০টা) রেখে পরের বার (অ্যাপ খোলায়) আবার পাঠায়।
 * পাঠানোর RPC: public.log_client_health (anon-কলযোগ্য, publishable key)।
 * কোনো ফোন নম্বর/ইমেইল/টোকেন যায় না। প্লাগিন কখনো অ্যাপ ক্র্যাশ করে না (সব catch)।
 */
@CapacitorPlugin(name = "SFHealth")
public class HealthPlugin extends Plugin {

    private static final String ENDPOINT = "https://hedloawcvnbleehnurqd.supabase.co/rest/v1/rpc/log_client_health";
    private static final String API_KEY = "sb_publishable_T58iE-MmcLsM3I2bQ7vofQ_9c6CG3qx";
    private static final long WATCHDOG_MS = 15000L;
    private static final String PREFS = "sf_health";
    private static final String QUEUE_KEY = "queue";
    private static final int MAX_QUEUE = 10;
    private static final int MAX_BATCH = 20;
    private static final String SESSION_ID = UUID.randomUUID().toString().substring(0, 12);
    private static final Object LOCK = new Object();

    private final Handler handler = new Handler(Looper.getMainLooper());
    private volatile boolean settled = false;

    private final Runnable watchdog = new Runnable() {
        @Override
        public void run() {
            if (settled) {
                return;
            }
            settled = true;
            try {
                JSONObject d = new JSONObject();
                d.put("waited_ms", WATCHDOG_MS);
                d.put("conn", describeConnection());
                d.put("private_dns", privateDns());
                d.put("auto_time", autoTime());
                d.put("data_saver", dataSaver());
                sendEvent("native_watchdog", d);
            } catch (Exception ignored) {
            }
        }
    };

    @Override
    public void load() {
        try {
            sendEvent("app_open", new JSONObject());
            handler.postDelayed(watchdog, WATCHDOG_MS);
        } catch (Exception ignored) {
        }
    }

    @Override
    protected void handleOnDestroy() {
        try {
            handler.removeCallbacks(watchdog);
        } catch (Exception ignored) {
        }
    }

    // ---------- JS থেকে ডাকা মেথড ----------

    @PluginMethod
    public void ready(PluginCall call) {
        settle();
        call.resolve();
    }

    @PluginMethod
    public void errorShown(PluginCall call) {
        settle();
        call.resolve();
    }

    @PluginMethod
    public void getInfo(PluginCall call) {
        JSObject r = new JSObject();
        try {
            r.put("model", Build.MODEL);
            r.put("os", Build.VERSION.RELEASE);
            r.put("webview", webViewMajor());
            r.put("appVersion", appVersion());
            r.put("conn", describeConnection());
            r.put("privateDns", privateDns());
            r.put("autoTime", autoTime());
            r.put("dataSaver", dataSaver());
        } catch (Exception ignored) {
        }
        call.resolve(r);
    }

    /** error.html বা ওয়েব থেকে ইভেন্ট পাঠানো — শুধু অনুমোদিত নামগুলো। */
    @PluginMethod
    public void report(PluginCall call) {
        try {
            String event = call.getString("event", "");
            if ("error_page".equals(event) || "user_report".equals(event) || "page_fail".equals(event)) {
                JSObject detail = call.getObject("detail");
                sendEvent(event, detail != null ? detail : new JSONObject());
            }
        } catch (Exception ignored) {
        }
        call.resolve();
    }

    // ---------- ভেতরের কাজ ----------

    private void settle() {
        settled = true;
        try {
            handler.removeCallbacks(watchdog);
        } catch (Exception ignored) {
        }
    }

    private JSONObject baseEvent(String event) throws Exception {
        JSONObject e = new JSONObject();
        e.put("event", event);
        e.put("device_id", deviceId());
        e.put("session_id", SESSION_ID);
        e.put("platform", isPro() ? "pro_app" : "android_app");
        e.put("app_version", appVersion());
        e.put("page", "/native");
        e.put("net_type", netType());
        e.put("device_model", Build.MODEL);
        e.put("os_version", Build.VERSION.RELEASE);
        e.put("webview_version", webViewMajor());
        return e;
    }

    private void sendEvent(String event, JSONObject detail) {
        try {
            JSONObject e = baseEvent(event);
            e.put("detail", detail != null ? detail : new JSONObject());
            final JSONArray batch = new JSONArray();
            batch.put(e);
            new Thread(new Runnable() {
                @Override
                public void run() {
                    deliver(batch);
                }
            }).start();
        } catch (Exception ignored) {
        }
    }

    /** নতুন ইভেন্ট + আগে জমে থাকা কিউ একসাথে পাঠায়; ব্যর্থ হলে কিউতে রাখে। */
    private void deliver(JSONArray fresh) {
        synchronized (LOCK) {
            try {
                JSONArray all = new JSONArray();
                JSONArray queued = readQueue();
                for (int i = 0; i < queued.length() && all.length() < MAX_BATCH - fresh.length(); i++) {
                    all.put(queued.get(i));
                }
                for (int i = 0; i < fresh.length(); i++) {
                    all.put(fresh.get(i));
                }
                if (post(all)) {
                    // পাঠানো গেছে; ব্যাচে না-ধরা বাকি কিউ (যদি থাকে) রেখে দিই
                    JSONArray rest = new JSONArray();
                    for (int i = Math.min(queued.length(), MAX_BATCH - fresh.length()); i < queued.length(); i++) {
                        rest.put(queued.get(i));
                    }
                    writeQueue(rest);
                } else {
                    // ব্যর্থ: আগের পুরো কিউ + নতুন ইভেন্ট রেখে দিই (পরের বার আবার চেষ্টা)
                    JSONArray keep = new JSONArray();
                    for (int i = 0; i < queued.length(); i++) {
                        keep.put(queued.get(i));
                    }
                    for (int i = 0; i < fresh.length(); i++) {
                        keep.put(fresh.get(i));
                    }
                    writeQueue(keep);
                }
            } catch (Exception ignored) {
            }
        }
    }

    private boolean post(JSONArray events) {
        HttpURLConnection c = null;
        try {
            JSONObject body = new JSONObject();
            body.put("p_events", events);
            byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
            c = (HttpURLConnection) new URL(ENDPOINT).openConnection();
            c.setConnectTimeout(10000);
            c.setReadTimeout(15000);
            c.setRequestMethod("POST");
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json");
            c.setRequestProperty("apikey", API_KEY);
            c.setFixedLengthStreamingMode(bytes.length);
            OutputStream os = c.getOutputStream();
            os.write(bytes);
            os.close();
            int code = c.getResponseCode();
            return code >= 200 && code < 300;
        } catch (Exception e) {
            return false;
        } finally {
            if (c != null) {
                try {
                    c.disconnect();
                } catch (Exception ignored) {
                }
            }
        }
    }

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private JSONArray readQueue() {
        try {
            String raw = prefs().getString(QUEUE_KEY, "[]");
            return new JSONArray(raw);
        } catch (Exception e) {
            return new JSONArray();
        }
    }

    private void writeQueue(JSONArray q) {
        try {
            JSONArray trimmed = new JSONArray();
            int start = Math.max(0, q.length() - MAX_QUEUE);
            for (int i = start; i < q.length(); i++) {
                trimmed.put(q.get(i));
            }
            prefs().edit().putString(QUEUE_KEY, trimmed.toString()).apply();
        } catch (Exception ignored) {
        }
    }

    // ---------- ডিভাইস ও নেটওয়ার্ক তথ্য ----------

    private boolean isPro() {
        try {
            return getContext().getPackageName().endsWith(".pro");
        } catch (Exception e) {
            return false;
        }
    }

    private String deviceId() {
        try {
            String id = Settings.Secure.getString(getContext().getContentResolver(), Settings.Secure.ANDROID_ID);
            return id != null ? "android:" + id : "android:unknown";
        } catch (Exception e) {
            return "android:unknown";
        }
    }

    private String appVersion() {
        try {
            PackageInfo p = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            long code = Build.VERSION.SDK_INT >= 28 ? p.getLongVersionCode() : p.versionCode;
            return p.versionName + "+" + code;
        } catch (Exception e) {
            return null;
        }
    }

    private String webViewMajor() {
        try {
            if (Build.VERSION.SDK_INT >= 26) {
                PackageInfo wv = WebView.getCurrentWebViewPackage();
                if (wv != null && wv.versionName != null) {
                    String v = wv.versionName;
                    int dot = v.indexOf('.');
                    return dot > 0 ? v.substring(0, dot) : v;
                }
            }
        } catch (Exception ignored) {
        }
        return null;
    }

    /** "wifi" | "cellular" | "vpn" | "offline" | "unknown" — ওয়েবের net_type ফিল্ডে যায়। */
    private String netType() {
        try {
            ConnectivityManager cm = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
            Network n = cm.getActiveNetwork();
            if (n == null) {
                return "offline";
            }
            NetworkCapabilities nc = cm.getNetworkCapabilities(n);
            if (nc == null) {
                return "unknown";
            }
            if (nc.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) {
                return "vpn";
            }
            if (nc.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) {
                return "wifi";
            }
            if (nc.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) {
                return "cellular";
            }
            return "other";
        } catch (Exception e) {
            return "unknown";
        }
    }

    /** যেমন "cellular+validated" / "wifi+unvalidated" — unvalidated মানে ফোন নিজেই বলছে ইন্টারনেট নেই। */
    private String describeConnection() {
        try {
            ConnectivityManager cm = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
            Network n = cm.getActiveNetwork();
            if (n == null) {
                return "none";
            }
            NetworkCapabilities nc = cm.getNetworkCapabilities(n);
            if (nc == null) {
                return "unknown";
            }
            String t = nc.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ? "wifi"
                    : nc.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) ? "cellular" : "other";
            boolean validated = nc.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED);
            boolean vpn = nc.hasTransport(NetworkCapabilities.TRANSPORT_VPN);
            return t + (validated ? "+validated" : "+unvalidated") + (vpn ? "+vpn" : "");
        } catch (Exception e) {
            return "unknown";
        }
    }

    /** off / opportunistic / hostname — Private DNS ভুল থাকলে সব সাইট ফেইল করে। */
    private String privateDns() {
        try {
            return Settings.Global.getString(getContext().getContentResolver(), "private_dns_mode");
        } catch (Exception e) {
            return null;
        }
    }

    /** ১ = অটো তারিখ-সময় চালু; ০ = বন্ধ (তারিখ ভুল হলে HTTPS ফেইল করে)। */
    private int autoTime() {
        try {
            return Settings.Global.getInt(getContext().getContentResolver(), Settings.Global.AUTO_TIME, 1);
        } catch (Exception e) {
            return 1;
        }
    }

    /** ১ = ডেটা সেভার বন্ধ, ২ = চালু (ব্যাকগ্রাউন্ড সীমিত), ৩ = চালু কিন্তু অ্যাপ ছাড়-পাওয়া। */
    private int dataSaver() {
        try {
            ConnectivityManager cm = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
            return cm.getRestrictBackgroundStatus();
        } catch (Exception e) {
            return 0;
        }
    }
}
