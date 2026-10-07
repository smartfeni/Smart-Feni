package com.smartfeni.app;

import android.annotation.SuppressLint;
import android.provider.Settings;

import com.android.installreferrer.api.InstallReferrerClient;
import com.android.installreferrer.api.InstallReferrerStateListener;
import com.android.installreferrer.api.ReferrerDetails;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.concurrent.atomic.AtomicBoolean;

/**
 * রেফার সিস্টেমের নেটিভ অংশ।
 *
 * ১) getInstallReferrer() — Google Play Install Referrer API থেকে পড়ে অ্যাপটা
 *    কোন লিংক/ক্যাম্পেইন থেকে ইনস্টল হয়েছে। রেফার লিংক Play Store-এ খোলার সময়
 *    "&referrer=ref_<কোড>" যুক্ত থাকে, সেটাই এখানে পাওয়া যায়।
 *    status মান:
 *      "ok"           — referrer স্ট্রিং পাওয়া গেছে (খালি হতে পারে)
 *      "unsupported"  — এই ডিভাইসে/Play Store-এ সুবিধাটা নেই (চূড়ান্ত উত্তর)
 *      "unavailable"  — Play Store সার্ভিস এই মুহূর্তে পাওয়া যায়নি (পরে আবার চেষ্টা করা যাবে)
 *      "error"        — অপ্রত্যাশিত সমস্যা (পরে আবার চেষ্টা করা যাবে)
 *
 * ২) getDeviceId() — "১ ফোন = ১ রেফার" চেকের জন্য ফোনের Android ID।
 *    অ্যাপ আনইনস্টল/রিইনস্টলে একই থাকে, শুধু ফ্যাক্টরি রিসেটে বদলায়।
 *
 * MainActivity.java তে registerPlugin(InstallReferrerPlugin.class) করা আছে।
 */
@CapacitorPlugin(name = "InstallReferrer")
public class InstallReferrerPlugin extends Plugin {

    @PluginMethod
    public void getInstallReferrer(final PluginCall call) {
        final AtomicBoolean done = new AtomicBoolean(false);
        final InstallReferrerClient client;

        try {
            client = InstallReferrerClient.newBuilder(getContext()).build();
        } catch (Exception e) {
            finish(call, done, "error", null);
            return;
        }

        try {
            client.startConnection(new InstallReferrerStateListener() {
                @Override
                public void onInstallReferrerSetupFinished(int responseCode) {
                    String status;
                    String referrer = null;

                    try {
                        if (responseCode == InstallReferrerClient.InstallReferrerResponse.OK) {
                            ReferrerDetails details = client.getInstallReferrer();
                            referrer = details != null ? details.getInstallReferrer() : null;
                            status = "ok";
                        } else if (responseCode == InstallReferrerClient.InstallReferrerResponse.FEATURE_NOT_SUPPORTED) {
                            status = "unsupported";
                        } else {
                            status = "unavailable";
                        }
                    } catch (Exception e) {
                        status = "error";
                    }

                    try {
                        client.endConnection();
                    } catch (Exception ignored) {
                        // সংযোগ বন্ধ করতে না পারলেও ফলাফল দেওয়া যাবে
                    }

                    finish(call, done, status, referrer);
                }

                @Override
                public void onInstallReferrerServiceDisconnected() {
                    // Play Store সার্ভিস হঠাৎ বিচ্ছিন্ন হলে JS-এর টাইমআউট ও পরের লঞ্চে আবার চেষ্টা সামলাবে
                }
            });
        } catch (Exception e) {
            finish(call, done, "error", null);
        }
    }

    @SuppressLint("HardwareIds")
    @PluginMethod
    public void getDeviceId(PluginCall call) {
        JSObject ret = new JSObject();
        try {
            String id = Settings.Secure.getString(
                getContext().getContentResolver(),
                Settings.Secure.ANDROID_ID
            );
            if (id != null && id.length() >= 8) {
                ret.put("id", "android:" + id);
            }
        } catch (Exception ignored) {
            // আইডি না পেলে "id" ফিল্ড থাকবে না — রেফার তখন কাউন্ট হবে না, অ্যাপ ঠিকই চলবে
        }
        call.resolve(ret);
    }

    // একই কলে দুইবার resolve না হওয়ার জন্য AtomicBoolean গার্ড
    private void finish(PluginCall call, AtomicBoolean done, String status, String referrer) {
        if (!done.compareAndSet(false, true)) return;

        JSObject ret = new JSObject();
        ret.put("status", status);
        if (referrer != null) {
            ret.put("referrer", referrer);
        }
        call.resolve(ret);
    }
}
