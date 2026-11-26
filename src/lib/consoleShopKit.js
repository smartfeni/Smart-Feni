// ============================================================
// consoleShopKit.js — নতুন অ্যাডমিন অ্যাপের দোকান/মেনু ফর্মের শেয়ার্ড অংশ (ধাপ ৫.২)
// পুরনো /admin/delivery-shops-এর হুবহু নিয়ম:
//   বাকেট delivery-shop-images (public), JPG/PNG/WebP, ৩MB সীমা, আপলোডের আগে কমপ্রেস (১২০০px, ০.৮)
//   দোকানের ছবি: shops/<uuid>.jpg · পণ্যের ছবি: items/<shop_id>/<uuid>.jpg
//   পুরনো ছবি বদলালে/সরালে স্টোরেজ থেকে মোছা হয় (সেভ সফল হলে তবেই)
// ব্যবহার: makeImagePicker(container) → { st, reset(url), upload(folder) }
// স্টাইল: পেজের is:global (.sk-img*)
// ============================================================
import { supabase } from './supabase.js';
import { compressImage } from './imageCompress.js';

export const BUCKET = 'delivery-shop-images';
const MAX_BYTES = 3 * 1024 * 1024;
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];

export const ITEM_TAGS = { popular: 'জনপ্রিয়', spicy: 'ঝাল', new: 'নতুন' };
export const WEEK_DAYS = ['রবিবার', 'সোমবার', 'মঙ্গলবার', 'বুধবার', 'বৃহস্পতিবার', 'শুক্রবার', 'শনিবার'];

const toast = (t, type) => window.showToast?.(t, type);

function storagePathOf(url) {
  if (typeof url !== 'string') return null;
  const parts = url.split('/' + BUCKET + '/');
  if (parts.length < 2) return null;
  try { return decodeURIComponent(parts[1].split('?')[0]); } catch (e) { return null; }
}

export async function removeStored(url) {
  const p = storagePathOf(url);
  if (!p) return;
  try { await supabase.storage.from(BUCKET).remove([p]); } catch (e) { /* রয়ে গেলেও ক্ষতি নেই */ }
}

async function uploadFile(file, folder) {
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const path = folder + '/' + crypto.randomUUID() + '.' + ext;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, cacheControl: '3600', upsert: false });
  if (error) {
    try { window.SFReportError?.({ kind: 'api_fail', action: 'console_shop_image_upload', title: 'দোকান/পণ্যের ছবি আপলোড ব্যর্থ (অ্যাডমিন অ্যাপ)', message: error.message || String(error) }); } catch (e) { /* চুপ */ }
    throw error;
  }
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

export function makeImagePicker(container, label = 'ছবি') {
  const st = { url: null, file: null, remove: false, objUrl: null };
  container.classList.add('sk-img');
  const box = document.createElement('div');
  box.className = 'sk-img-box';
  const btns = document.createElement('div');
  btns.className = 'sk-img-btns';
  const pick = document.createElement('button');
  pick.type = 'button';
  pick.className = 'sk-img-btn';
  const rm = document.createElement('button');
  rm.type = 'button';
  rm.className = 'sk-img-btn red';
  rm.textContent = label + ' সরান';
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = ALLOWED.join(',');
  input.hidden = true;
  btns.append(pick, rm, input);
  container.append(box, btns);

  const dropObj = () => { if (st.objUrl) { URL.revokeObjectURL(st.objUrl); st.objUrl = null; } };
  function paint() {
    box.textContent = '';
    const src = st.file ? st.objUrl : (st.remove ? null : st.url);
    if (src) {
      const im = document.createElement('img');
      im.alt = '';
      im.src = src;
      box.appendChild(im);
    } else {
      box.textContent = label + ' নেই';
    }
    rm.hidden = !src;
    pick.textContent = src ? label + ' বদলান' : label + ' যোগ করুন';
  }
  pick.addEventListener('click', () => input.click());
  rm.addEventListener('click', () => { dropObj(); st.file = null; st.remove = true; paint(); });
  input.addEventListener('change', async () => {
    const f = input.files && input.files[0];
    input.value = '';
    if (!f) return;
    if (!f.type || f.type.indexOf('image/') !== 0) { toast('শুধু ছবি বাছুন।', 'error'); return; }
    pick.disabled = true;
    let out = f;
    try { out = await compressImage(f, { maxDimension: 1200, quality: 0.8, mimeType: 'image/jpeg', skipIfSmallerThan: 200 * 1024 }); } catch (e) { out = f; }
    pick.disabled = false;
    if (!ALLOWED.includes(out.type)) { toast('শুধু JPG, PNG বা WebP ছবি দেওয়া যাবে।', 'error'); return; }
    if (out.size > MAX_BYTES) { toast('ছবি ৩MB-এর বেশি। ছোট ছবি বাছুন।', 'error'); return; }
    dropObj();
    st.file = out;
    st.objUrl = URL.createObjectURL(out);
    st.remove = false;
    paint();
  });

  return {
    st,
    reset(url) { dropObj(); st.url = url || null; st.file = null; st.remove = false; paint(); },
    // সেভের আগে: নতুন ফাইল থাকলে আপলোড। ফেরত { value: undefined | null | url, newUrl, old }
    async prepare(folder) {
      if (st.file) {
        const url = await uploadFile(st.file, folder);
        return { value: url, newUrl: url, old: st.url };
      }
      if (st.remove) return { value: null, newUrl: null, old: st.url };
      return { value: undefined, newUrl: null, old: null };
    },
  };
}

// ইনপুট + লেবেল + লাল * + error ঘর (SFValidateForm-এর data-error-for)
export function field(parent, label, input, opts = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'sk-field';
  const id = input.id || ('sk-' + Math.random().toString(36).slice(2, 8));
  input.id = id;
  const l = document.createElement('label');
  l.htmlFor = id;
  l.textContent = label;
  if (opts.required) {
    const m = document.createElement('span');
    m.className = 'required-mark';
    m.textContent = '*';
    l.appendChild(m);
    input.required = true;
  }
  if (opts.hint) {
    const s = document.createElement('small');
    s.textContent = ' ' + opts.hint;
    l.appendChild(s);
  }
  wrap.append(l, input);
  if (opts.required) {
    const err = document.createElement('div');
    err.className = 'field-error-msg';
    err.dataset.errorFor = id;
    const sp = document.createElement('span');
    sp.textContent = opts.errorText || (label + ' দিন');
    err.appendChild(sp);
    wrap.appendChild(err);
  }
  parent.appendChild(wrap);
  return input;
}

export function switchRow(parent, title, desc, on) {
  const row = document.createElement('div');
  row.className = 'sk-sw';
  const t = document.createElement('div');
  t.className = 'sk-sw-t';
  const b = document.createElement('b');
  b.textContent = title;
  t.appendChild(b);
  if (desc) {
    const s = document.createElement('small');
    s.textContent = desc;
    t.appendChild(s);
  }
  const sw = document.createElement('button');
  sw.type = 'button';
  sw.className = 'sk-toggle';
  sw.setAttribute('role', 'switch');
  sw.setAttribute('aria-label', title);
  sw.setAttribute('aria-checked', String(!!on));
  sw.addEventListener('click', () => { if (!sw.disabled) sw.setAttribute('aria-checked', String(sw.getAttribute('aria-checked') !== 'true')); });
  row.append(t, sw);
  parent.appendChild(row);
  return { sw, get: () => sw.getAttribute('aria-checked') === 'true', set: (v) => sw.setAttribute('aria-checked', String(!!v)) };
}

// শেয়ার্ড CSS (পেজে is:global দিয়ে বসানো নয়, এখানে একবার ইনজেক্ট)
let cssDone = false;
export function injectShopKitCss() {
  if (cssDone) return;
  cssDone = true;
  const s = document.createElement('style');
  s.textContent = [
    '.sk-img{display:flex;gap:12px;align-items:center}',
    '.sk-img-box{width:84px;height:84px;flex:none;border-radius:16px;background:#EFEBE5;display:flex;align-items:center;justify-content:center;overflow:hidden;font-size:12px;color:#5F6B7E;text-align:center}',
    '.sk-img-box img{width:100%;height:100%;object-fit:cover}',
    '.sk-img-btns{display:flex;flex-direction:column;gap:6px}',
    '.sk-img-btn{height:38px;padding:0 14px;border-radius:10px;border:1px solid #E7E2DA;background:#fff;color:#1B2A4A;font:inherit;font-size:13.5px;font-weight:600;cursor:pointer}',
    '.sk-img-btn.red{color:#B3261E}',
    '.sk-img-btn[hidden]{display:none}',
    '.sk-field{display:flex;flex-direction:column;gap:5px}',
    '.sk-field label{font-size:13px;font-weight:600;color:#1B2A4A}',
    '.sk-field label small{font-weight:400;color:#5F6B7E}',
    '.sk-in{width:100%;box-sizing:border-box;min-height:44px;border:1px solid #E7E2DA;border-radius:12px;padding:0 12px;font:inherit;font-size:15px;color:#1B2A4A;background:#fff}',
    'textarea.sk-in{padding:10px 12px;min-height:84px}',
    '.sk-in:focus{outline:2px solid #1B2A4A;outline-offset:-1px}',
    '.sk-two{display:grid;grid-template-columns:1fr 1fr;gap:10px}',
    '.sk-chips{display:flex;flex-wrap:wrap;gap:6px}',
    '.sk-chips button{height:36px;padding:0 13px;border-radius:999px;border:1px solid #E7E2DA;background:#fff;color:#1B2A4A;font:inherit;font-size:13.5px;font-weight:600;cursor:pointer}',
    '.sk-chips button[aria-pressed="true"]{background:#1B2A4A;border-color:#1B2A4A;color:#fff}',
    '.sk-sw{display:flex;align-items:center;gap:12px;padding:10px 0}',
    '.sk-sw+.sk-sw{border-top:1px solid #EFEBE5}',
    '.sk-sw-t{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}',
    '.sk-sw-t b{font-size:14.5px;font-weight:600}',
    '.sk-sw-t small{font-size:12.5px;color:#5F6B7E;line-height:1.45}',
    '.sk-toggle{position:relative;width:48px;height:28px;flex:none;border-radius:999px;border:0;background:#CBD2DC;cursor:pointer;transition:background .15s}',
    '.sk-toggle::after{content:"";position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.2);transition:transform .15s}',
    '.sk-toggle[aria-checked="true"]{background:#17663F}',
    '.sk-toggle[aria-checked="true"]::after{transform:translateX(20px)}',
    '.sk-toggle:disabled{opacity:.5;cursor:default}',
    '.sk-err{margin:0;font-size:13.5px;font-weight:600;color:#B3261E;background:#FDECEA;border-radius:10px;padding:8px 10px}',
    '.sk-err[hidden]{display:none}',
    '.sk-hint{margin:0;font-size:12.5px;color:#5F6B7E}',
  ].join('');
  document.head.appendChild(s);
}
