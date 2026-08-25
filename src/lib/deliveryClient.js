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

export function cancelRequest({ requestId }) {
  return callDeliveryApi('cancel-request', { requestId });
}

export function markReceived({ requestId }) {
  return callDeliveryApi('mark-received', { requestId });
}

export function submitReview({ requestId, rating, comment }) {
  return callDeliveryApi('submit-review', { requestId, rating, comment });
}

// ============ কাস্টমার সাইড — Smart Hero / Ride Hero "সেরা মূল্য" মডেল ============
// (নতুন মডেল — Delivery Hero ও Ride Hero দুই ক্যাটাগরিতেই শেয়ার্ড)

export function createServiceRequest({
  category,
  upazila,
  pickupAddress,
  pickupLat,
  pickupLng,
  pickupInstructions,
  dropAddress,
  dropLat,
  dropLng,
  dropInstructions,
  description,
  vehicleType,
  seatCount,
  askingPrice,
}) {
  return callDeliveryApi('create-request', {
    category,
    upazila,
    pickupAddress,
    pickupLat,
    pickupLng,
    pickupInstructions,
    dropAddress,
    dropLat,
    dropLng,
    dropInstructions,
    description,
    vehicleType,
    seatCount,
    askingPrice,
  });
}

// কাস্টমার নিজের asking price শুধু বাড়াতে পারবে (API-সাইডে ভ্যালিডেট হবে)
export function updateAskingPrice({ requestId, newPrice }) {
  return callDeliveryApi('update-asking-price', { requestId, newPrice });
}

// বর্তমান সেরা মূল্য (customer asking price বনাম সর্বনিম্ন active hero অফার — যেটা কম)
export function getBestPrice({ requestId }) {
  return callDeliveryApi('get-best-price', { requestId });
}

// কাস্টমার বর্তমান সর্বনিম্ন হিরো অফার নিশ্চিত করলে (অ্যাটমিক)
export function confirmBestPrice({ requestId }) {
  return callDeliveryApi('confirm-best-price', { requestId });
}

// হিরো কাস্টমারের asking price-এ সরাসরি accept করলে (অ্যাটমিক, ফার্স্ট-ক্লিক-উইন্স)
export function acceptBestPrice({ requestId }) {
  return callDeliveryApi('accept-best-price', { requestId });
}

// ============ রাইডার/হিরো সাইড ============

export function withdrawOffer({ requestId }) {
  return callDeliveryApi('withdraw-offer', { requestId });
}

export function confirmDelivery({ requestId }) {
  return callDeliveryApi('confirm-delivery', { requestId });
}

// ============ হিরো সাইড — Smart Hero / Ride Hero "সেরা মূল্য" মডেল ============
// (নতুন মডেল — হিরো শুধু কাস্টমারের বর্তমান দামে Accept করতে পারবে,
// বা বর্তমান সেরা মূল্যের চেয়ে কমপক্ষে ৳১ কম নতুন অফার দিতে পারবে)

// রেজিস্ট্রেশনের ২টা ক্যাটাগরি চেকবক্স (ডেলিভারি/রাইড) + vehicle type একসাথে সেভ
export function registerHero({ vehicleType, offersDelivery, offersRide, upazila, photoUrl, idCardPhotoUrl }) {
  return callDeliveryApi('rider-register', {
    vehicleType,
    offersDelivery,
    offersRide,
    upazila,
    photoUrl,
    idCardPhotoUrl,
  });
}

// নতুন প্রতিযোগিতামূলক অফার (বর্তমান সেরা মূল্যের চেয়ে ৳১ কম হতে হবে — API ভ্যালিডেট করবে)
export function submitHeroOffer({ requestId, offerPrice }) {
  return callDeliveryApi('submit-offer', { requestId, offerPrice });
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