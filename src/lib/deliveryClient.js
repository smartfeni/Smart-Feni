// ============================================================
// Delivery Hero এর ফ্রন্টএন্ড শেয়ার্ড হেল্পার
// সব API কল এখান দিয়েই যাবে — access token সেট করে, error handle
// করে, JSON parse করে দেয়। contentEngagement.js এর প্যাটার্নে।
// ============================================================

import { supabase } from './supabase.js';

async function getAccessToken() {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token || null;
}

async function callDeliveryApi(endpoint, body) {
  const token = await getAccessToken();
  if (!token) {
    return { error: 'লগইন করা নেই, আগে লগইন করো' };
  }

  try {
    const res = await fetch(`/api/delivery/${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body || {}),
    });

    const data = await res.json();

    if (!res.ok) {
      return { error: data.error || 'অপ্রত্যাশিত ত্রুটি ঘটেছে' };
    }

    return { data };
  } catch (err) {
    return { error: 'নেটওয়ার্ক সমস্যা: ' + err.message };
  }
}

// ============ পাবলিক/হাউজকিপিং (auth লাগে না) ============

export async function expireRequests() {
  try {
    await fetch('/api/delivery/expire-requests', { method: 'POST' });
  } catch (err) {
    // silent — housekeeping কল, ব্যর্থ হলেও UI ব্লক করবে না
    console.error('expire-requests কল ব্যর্থ:', err.message);
  }
}

// ============ কাস্টমার সাইড ============

export function createDeliveryRequest({ upazila, areaDetail, description, vehicleType, initialPrice }) {
  return callDeliveryApi('create-request', {
    upazila,
    areaDetail,
    description,
    vehicleType,
    initialPrice,
  });
}

export function customerRespond({ requestId, riderProfileId, action, offerPrice }) {
  return callDeliveryApi('customer-respond', { requestId, riderProfileId, action, offerPrice });
}

export function cancelRequest({ requestId }) {
  return callDeliveryApi('cancel-request', { requestId });
}

export function markReceived({ requestId }) {
  return callDeliveryApi('mark-received', { requestId });
}

export function submitReview({ requestId, rating, comment }) {
  return callDeliveryApi('submit-review', { requestId, rating, comment });
}

// ============ রাইডার সাইড ============

export function registerRider({ vehicleType, photoUrl, idCardPhotoUrl }) {
  return callDeliveryApi('rider-register', { vehicleType, photoUrl, idCardPhotoUrl });
}

export function riderRespond({ requestId, action, offerPrice }) {
  return callDeliveryApi('rider-respond', { requestId, action, offerPrice });
}

export function confirmDelivery({ requestId }) {
  return callDeliveryApi('confirm-delivery', { requestId });
}

// ============ শেয়ার্ড (দুই পক্ষই ব্যবহার করতে পারে) ============

export function raiseDispute({ requestId, reason }) {
  return callDeliveryApi('raise-dispute', { requestId, reason });
}

export function uploadPaymentProof({ requestId, imageUrls }) {
  return callDeliveryApi('upload-payment-proof', { requestId, imageUrls });
}

// ============ এডমিন সাইড ============

export function verifyRider({ riderId, decision, rejectionReason }) {
  return callDeliveryApi('admin/verify-rider', { riderId, decision, rejectionReason });
}

export function resolveDispute({ requestId, resolution }) {
  return callDeliveryApi('admin/resolve-dispute', { requestId, resolution });
}

export function deleteRider({ riderId }) {
  return callDeliveryApi('admin/delete-rider', { riderId });
}