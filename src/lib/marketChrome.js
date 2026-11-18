// মার্কেট (কুইক ডেলিভারি) পেজে: নেটিভ অ্যাপে সাইটের হেডার লুকানো, ওয়েবে যেমন আছে তেমন।
import { isNativeApp } from './native-bridge.js';

export function hideHeaderInApp() {
  try {
    if (!isNativeApp()) return;
    const st = document.createElement('style');
    st.textContent = '#siteNavbar { display: none !important; }';
    document.head.appendChild(st);
  } catch (e) { /* উপেক্ষা */ }
}
