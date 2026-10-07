// ============================================================
// src/lib/referral.js — রেফার সিস্টেম: সাইন আপের পর রেফার কোড সার্ভারে পাঠানো
//
// কীভাবে কাজ করে:
//   ১) ইউজার রেফার লিংক (smartfeni.com/r/<কোড>) থেকে Play Store হয়ে অ্যাপ ইনস্টল করে
//   ২) অ্যাপ প্রথমবার খুললে native-bridge.js কোডটা Preferences-এ রাখে (sf_pending_ref)
//   ৩) সাইন আপ শেষে AuthModal এই ফাইলের applyPendingReferral() ডাকে
//   ৪) এটা কোড + ফোনের আইডি দিয়ে ডাটাবেজের apply_referral() RPC কল করে
//
// কাউন্ট হলো কি হলো না (বা ১০০ লিমিট পার হয়েছে কি না) ইউজারকে কিছুই দেখানো হয় না —
// RPC এর উত্তর ইচ্ছাকৃতভাবে ফেলে দেওয়া হয়। সব যাচাই (ডিভাইস/ফোন ডুপ্লিকেট, নিজের
// কোড, লিমিট) সার্ভারে হয়।
//
// ওয়েবসাইটে (ব্রাউজারে) এটা কিছুই করে না — রেফার শুধু অ্যাপ ইনস্টলে গোনা হয়।
// কোনো কারণে ফেইল করলে সাইন আপ আটকায় না, চুপচাপ বাদ।
// ============================================================

import { supabase } from './supabase.js';
import {
  isNativeApp,
  getPendingReferralCode,
  getNativeDeviceId,
  clearPendingReferral,
} from './native-bridge.js';

const APPLY_TIMEOUT_MS = 5000;
const RETRY_DELAY_MS = 1500;

async function callApplyReferral(code, deviceId) {
  const { error } = await supabase.rpc('apply_referral', {
    p_code: code,
    p_device_id: deviceId,
  });
  return !error;
}

async function applyOnce() {
  if (!isNativeApp()) return;

  const code = await getPendingReferralCode();
  if (!code) return;

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return; // সেশন না থাকলে কোড রেখে দেওয়া হয়, পরে আবার চেষ্টা করা যাবে

  const deviceId = await getNativeDeviceId();

  let ok = await callApplyReferral(code, deviceId);
  if (!ok) {
    // নেটওয়ার্কের সাময়িক সমস্যা হলে একবার আবার চেষ্টা
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    ok = await callApplyReferral(code, deviceId);
  }

  // সার্ভার উত্তর দিলে (গোনা হোক বা না হোক) কোড আর রাখার দরকার নেই
  if (ok) await clearPendingReferral();
}

// সাইন আপ UI আটকে না রাখতে সর্বোচ্চ ৫ সেকেন্ড অপেক্ষা করে; কখনো error ছোঁড়ে না
export async function applyPendingReferral() {
  try {
    await Promise.race([
      applyOnce(),
      new Promise((resolve) => setTimeout(resolve, APPLY_TIMEOUT_MS)),
    ]);
  } catch (err) {
    // রেফার ফেইল করলেও অ্যাকাউন্ট তৈরি স্বাভাবিক চলবে
  }
}
