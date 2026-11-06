package com.smartfeni.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // রেফার সিস্টেমের কাস্টম নেটিভ প্লাগিন — অবশ্যই super.onCreate() এর আগে রেজিস্টার করতে হয়
        registerPlugin(InstallReferrerPlugin.class);
        // ইউজার হেলথ: অ্যাপ খোলা ping + পেজ না এলে ১৫ সেকেন্ডে watchdog (HealthPlugin.java)
        registerPlugin(HealthPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
