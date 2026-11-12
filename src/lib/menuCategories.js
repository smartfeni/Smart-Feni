// path: src/lib/menuCategories.js
// ============================================================
// শেয়ার্ড: ইনস্ট্যান্ট শপের মেনু ক্যাটাগরি ম্যানেজার (নিচের শিট)
// ব্যবহার: openCategorySheet({ supabase, shopId, toast, onChanged })
// কাজ: ক্যাটাগরি যোগ / নাম বদল (ঘরে লিখে বাইরে ট্যাপ বা Enter) / মোছা (আইটেম মুছে না,
//       শুধু "ক্যাটাগরি ছাড়া" হয়) / গ্রিপ ধরে টেনে ক্রম বদল।
// RPC: shop_save_category, shop_delete_category, shop_reorder (মালিক বা অ্যাডমিন)।
// নিজের CSS নিজেই ইনজেক্ট করে, তাই দুই পেজেই একই চেহারা।
// ইউজারের লেখা সব textContent/value দিয়ে (innerHTML নয়)।
// ============================================================
import { makeSortable } from './sortable.js';

let cssDone = false;
function injectCss() {
  if (cssDone) return;
  cssDone = true;
  const st = document.createElement('style');
  st.textContent =
    '.sfc-ov{position:fixed;inset:0;z-index:1100;background:rgba(27,42,74,.5);display:flex;align-items:flex-end;justify-content:center;font-family:"Hind Siliguri",system-ui,sans-serif;color:#1B2A4A;}' +
    '.sfc-sheet{width:100%;max-width:520px;max-height:90vh;overflow-y:auto;background:#fff;border-radius:28px 28px 0 0;padding:10px 20px calc(24px + env(safe-area-inset-bottom,0px));box-shadow:0 -6px 24px rgba(27,42,74,.12);box-sizing:border-box;}' +
    '.sfc-grip0{width:44px;height:5px;border-radius:3px;background:#D5DCE8;margin:2px auto 10px;}' +
    '.sfc-h{display:flex;align-items:center;justify-content:space-between;gap:8px;}' +
    '.sfc-h h2{margin:0;font-size:20px;font-weight:700;}' +
    '.sfc-x{width:44px;height:44px;border-radius:22px;border:0;background:#F1F5F9;color:#1B2A4A;cursor:pointer;font-size:16px;}' +
    '.sfc-hint{margin:4px 0 10px;font-size:13px;color:#5B6B86;}' +
    '.sfc-list{display:flex;flex-direction:column;gap:8px;}' +
    '.sfc-row{display:flex;align-items:center;gap:8px;background:#F8FAFC;border:1.5px solid #E3E8F0;border-radius:14px;padding:4px 6px;min-height:52px;}' +
    '.sfc-grip{width:44px;height:44px;display:flex;align-items:center;justify-content:center;color:#8A97AE;cursor:grab;flex:none;touch-action:none;}' +
    '.sfc-in{flex:1;min-width:0;border:0;background:transparent;font:inherit;font-size:15.5px;font-weight:600;color:#1B2A4A;min-height:44px;outline:0;}' +
    '.sfc-in:focus{background:#fff;border-radius:10px;padding:0 8px;}' +
    '.sfc-del{width:44px;height:44px;border:0;background:none;color:#B3261E;font-size:16px;cursor:pointer;flex:none;}' +
    '.sfc-add{display:flex;gap:8px;margin-top:12px;}' +
    '.sfc-add input{flex:1;min-width:0;border:1.5px solid #D5DCE8;border-radius:14px;padding:10px 14px;font:inherit;font-size:15px;min-height:48px;box-sizing:border-box;}' +
    '.sfc-btn{height:48px;border:0;border-radius:14px;background:#FF6B35;color:#1B2A4A;font:inherit;font-weight:700;font-size:15px;padding:0 18px;cursor:pointer;flex:none;}' +
    '.sfc-btn:disabled{opacity:.55;}' +
    '.sfc-close{width:100%;height:46px;margin-top:12px;border:1.5px solid #D5DCE8;border-radius:14px;background:#fff;color:#1B2A4A;font:inherit;font-weight:600;font-size:15px;cursor:pointer;}' +
    '.sfc-empty{font-size:14px;color:#5B6B86;padding:6px 2px;}';
  document.head.appendChild(st);
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}

const REASONS = {
  duplicate: 'এই নামে ক্যাটাগরি আগেই আছে।',
  name_required: 'ক্যাটাগরির নাম লিখুন।',
  too_many: 'সর্বোচ্চ ৩০টি ক্যাটাগরি রাখা যায়।',
};

export function openCategorySheet(cfg) {
  injectCss();
  const supabase = cfg.supabase;
  const shopId = cfg.shopId;
  const toast = cfg.toast || function () {};
  let dirty = false;
  let busy = false;
  let stopSort = null;

  const ov = el('div', 'sfc-ov');
  const sheet = el('div', 'sfc-sheet');
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', 'মেনু ক্যাটাগরি');
  sheet.appendChild(el('div', 'sfc-grip0'));
  const hd = el('div', 'sfc-h');
  hd.appendChild(el('h2', '', 'মেনু ক্যাটাগরি'));
  const xb = el('button', 'sfc-x');
  xb.type = 'button';
  xb.setAttribute('aria-label', 'বন্ধ করুন');
  xb.innerHTML = '<i class="fas fa-xmark"></i>';
  hd.appendChild(xb);
  sheet.appendChild(hd);
  sheet.appendChild(el('p', 'sfc-hint', 'গ্রিপ (⋮⋮) ধরে টেনে ক্রম বদলান। নাম বদলাতে লিখে বাইরে ট্যাপ করুন।'));
  const list = el('div', 'sfc-list');
  sheet.appendChild(list);

  const addRow = el('div', 'sfc-add');
  const addIn = document.createElement('input');
  addIn.type = 'text';
  addIn.maxLength = 60;
  addIn.placeholder = 'নতুন ক্যাটাগরি (যেমন: বিরিয়ানি)';
  addIn.setAttribute('aria-label', 'নতুন ক্যাটাগরির নাম');
  const addBtn = el('button', 'sfc-btn', 'যোগ');
  addBtn.type = 'button';
  addRow.appendChild(addIn);
  addRow.appendChild(addBtn);
  sheet.appendChild(addRow);
  const closeBtn = el('button', 'sfc-close', 'বন্ধ করুন');
  closeBtn.type = 'button';
  sheet.appendChild(closeBtn);
  ov.appendChild(sheet);
  document.body.appendChild(ov);

  function close() {
    if (stopSort) { stopSort(); stopSort = null; }
    if (ov.parentNode) ov.parentNode.removeChild(ov);
    if (dirty && typeof cfg.onChanged === 'function') cfg.onChanged();
  }
  xb.addEventListener('click', close);
  closeBtn.addEventListener('click', close);
  ov.addEventListener('click', function (e) { if (e.target === ov) close(); });

  async function load() {
    const r = await supabase.from('delivery_shop_categories').select('id, name, sort_order').eq('shop_id', shopId).order('sort_order', { ascending: true }).order('name', { ascending: true });
    if (r.error) { toast('ক্যাটাগরি লোড হয়নি, আবার চেষ্টা করুন', 'error'); return; }
    render(r.data || []);
  }

  function render(cats) {
    if (stopSort) { stopSort(); stopSort = null; }
    list.textContent = '';
    if (!cats.length) { list.appendChild(el('p', 'sfc-empty', 'এখনো কোনো ক্যাটাগরি নেই। নিচে নাম লিখে যোগ করুন।')); return; }
    cats.forEach(function (c) {
      const row = el('div', 'sfc-row');
      row.setAttribute('data-id', c.id);
      const g = el('span', 'sfc-grip');
      g.setAttribute('data-sort-handle', '1');
      g.setAttribute('aria-hidden', 'true');
      g.innerHTML = '<i class="fas fa-grip-vertical"></i>';
      const inp = document.createElement('input');
      inp.className = 'sfc-in';
      inp.type = 'text';
      inp.maxLength = 60;
      inp.value = c.name;
      inp.setAttribute('aria-label', 'ক্যাটাগরির নাম');
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') inp.blur(); });
      inp.addEventListener('change', async function () {
        const nv = inp.value.trim();
        if (nv === c.name) return;
        const res = await supabase.rpc('shop_save_category', { p_shop_id: shopId, p_category_id: c.id, p_name: nv });
        if (res.error || !res.data || !res.data.ok) {
          inp.value = c.name;
          toast((res.data && REASONS[res.data.reason]) || 'নাম বদলানো যায়নি', 'error');
          return;
        }
        c.name = nv;
        dirty = true;
        toast('নাম বদলেছে ✓', 'success');
      });
      const del = el('button', 'sfc-del');
      del.type = 'button';
      del.setAttribute('aria-label', c.name + ' মুছুন');
      del.innerHTML = '<i class="fas fa-trash"></i>';
      del.addEventListener('click', async function () {
        if (!confirm('"' + c.name + '" ক্যাটাগরি মুছবেন? আইটেম মুছবে না, শুধু ক্যাটাগরি ছাড়া হয়ে যাবে।')) return;
        const res = await supabase.rpc('shop_delete_category', { p_category_id: c.id });
        if (res.error || !res.data || !res.data.ok) { toast('মোছা যায়নি, আবার চেষ্টা করুন', 'error'); return; }
        dirty = true;
        toast('ক্যাটাগরি মুছে গেছে', 'success');
        load();
      });
      row.appendChild(g);
      row.appendChild(inp);
      row.appendChild(del);
      list.appendChild(row);
    });
    if (cats.length > 1) {
      stopSort = makeSortable(list, {
        itemSelector: '.sfc-row',
        handle: '.sfc-grip',
        onChange: async function (ids) {
          const res = await supabase.rpc('shop_reorder', { p_shop_id: shopId, p_kind: 'categories', p_ids: ids });
          if (res.error || !res.data || !res.data.ok) { toast('ক্রম সেভ হয়নি, আবার চেষ্টা করুন', 'error'); load(); return; }
          dirty = true;
        },
      });
    }
  }

  async function add() {
    if (busy) return;
    const nv = addIn.value.trim();
    if (!nv) { toast('ক্যাটাগরির নাম লিখুন।', 'error'); return; }
    busy = true;
    addBtn.disabled = true;
    const res = await supabase.rpc('shop_save_category', { p_shop_id: shopId, p_category_id: null, p_name: nv });
    busy = false;
    addBtn.disabled = false;
    if (res.error || !res.data || !res.data.ok) { toast((res.data && REASONS[res.data.reason]) || 'যোগ করা যায়নি, আবার চেষ্টা করুন', 'error'); return; }
    addIn.value = '';
    dirty = true;
    toast('ক্যাটাগরি যোগ হয়েছে ✓', 'success');
    load();
  }
  addBtn.addEventListener('click', add);
  addIn.addEventListener('keydown', function (e) { if (e.key === 'Enter') add(); });

  load();
}
