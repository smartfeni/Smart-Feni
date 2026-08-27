// ============================================================
// API এন্ডপয়েন্ট: Telegram নোটিফিকেশন disconnect করা
// (/api/telegram/disconnect) — profiles.telegram_chat_id null করে
// দেয়। এরপর আর কোনো নোটিফিকেশন যাবে না, চাইলে আবার /start করে
// রিকানেক্ট করা যাবে।
// ============================================================

import { getAuthedUser } from '../../../lib/deliverySupabase.js';

export const prerender = false;

export async function POST({ request }) {
  try {
    const { client, user, error: authError } = await getAuthedUser(request);
    if (authError) {
      return new Response(JSON.stringify({ error: authError }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { error: updateError } = await client
      .from('profiles')
      .update({ telegram_chat_id: null })
      .eq('id', user.id);

    if (updateError) {
      return new Response(
        JSON.stringify({ error: 'Disconnect ব্যর্থ: ' + updateError.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'অপ্রত্যাশিত ত্রুটি: ' + err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}