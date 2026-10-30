// ============================================================
// ডোনার লিস্ট এক্সপোর্ট — PDF / ছবি (PNG) / Excel (.xlsx) ডাউনলোড
// কোনো বাইরের লাইব্রেরি ছাড়া:
//   • ছবি: <canvas> এ আঁকা (ব্রাউজার নিজেই বাংলা ঠিকমতো রেন্ডার করে)
//   • PDF: ক্যানভাসের পেজগুলো JPEG করে হাতে বানানো PDF-এ বসানো
//     (PDF-এ বাংলা সরাসরি লেখা যায় না, তাই ছবি আকারে; লেখা সিলেক্ট/কপি হবে না)
//   • Excel: ছোট .xlsx (zip, কম্প্রেশন ছাড়া) হাতে বানানো
// অ্যাপের ভেতরে (Capacitor) ফাইল সেভ হয় ফোনের Documents/SmartFeni ফোল্ডারে;
// ব্রাউজারে সাধারণ ডাউনলোড।
// ============================================================

import { isNativeApp } from './native-bridge.js';

const GROUP_ORDER = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

function sortedRows(donors) {
  return [...(donors || [])].sort((a, b) => {
    const ga = GROUP_ORDER.indexOf(a.blood_group);
    const gb = GROUP_ORDER.indexOf(b.blood_group);
    if (ga !== gb) return (ga === -1 ? 99 : ga) - (gb === -1 ? 99 : gb);
    return String(a.name || '').localeCompare(String(b.name || ''), 'bn');
  });
}

function dateLabel() {
  return new Date().toLocaleDateString('bn-BD', { timeZone: 'Asia/Dhaka', day: 'numeric', month: 'long', year: 'numeric' });
}

function fileStamp() {
  const d = new Date(Date.now() + 6 * 3600 * 1000); // বাংলাদেশ সময়
  return d.toISOString().slice(0, 10);
}

// ---------------- Excel (.xlsx) ----------------
function xmlEsc(s) {
  return String(s ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function concatBytes(chunks) {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  chunks.forEach((c) => { out.set(c, off); off += c.length; });
  return out;
}

// files: [{ name, data: Uint8Array }] → zip (store, কম্প্রেশন নেই)
export function buildZip(files) {
  const enc = new TextEncoder();
  const locals = [];
  const centrals = [];
  let offset = 0;
  const dosTime = 0;
  const dosDate = (46 << 9) | (1 << 5) | 1; // ২০২৬-০১-০১, স্থির মান

  files.forEach((f) => {
    const nameBytes = enc.encode(f.name);
    const crc = crc32(f.data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true);
    lh.setUint16(4, 20, true);
    lh.setUint16(6, 0x0800, true);
    lh.setUint16(8, 0, true);
    lh.setUint16(10, dosTime, true);
    lh.setUint16(12, dosDate, true);
    lh.setUint32(14, crc, true);
    lh.setUint32(18, f.data.length, true);
    lh.setUint32(22, f.data.length, true);
    lh.setUint16(26, nameBytes.length, true);
    lh.setUint16(28, 0, true);
    const localHeader = concatBytes([new Uint8Array(lh.buffer), nameBytes]);
    locals.push(localHeader, f.data);

    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true);
    ch.setUint16(4, 20, true);
    ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true);
    ch.setUint16(12, dosTime, true);
    ch.setUint16(14, dosDate, true);
    ch.setUint32(16, crc, true);
    ch.setUint32(20, f.data.length, true);
    ch.setUint32(24, f.data.length, true);
    ch.setUint16(28, nameBytes.length, true);
    ch.setUint16(30, 0, true);
    ch.setUint16(32, 0, true);
    ch.setUint16(34, 0, true);
    ch.setUint16(36, 0, true);
    ch.setUint32(38, 0, true);
    ch.setUint32(42, offset, true);
    centrals.push(concatBytes([new Uint8Array(ch.buffer), nameBytes]));

    offset += localHeader.length + f.data.length;
  });

  const centralBytes = concatBytes(centrals);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralBytes.length, true);
  end.setUint32(16, offset, true);

  return concatBytes([...locals, centralBytes, new Uint8Array(end.buffer)]);
}

export function buildXlsx(donors, clubName) {
  const enc = new TextEncoder();
  const rows = sortedRows(donors);
  const header = ['নং', 'নাম', 'ব্লাড গ্রুপ', 'ফোন', 'উপজেলা'];
  const colLetters = ['A', 'B', 'C', 'D', 'E'];

  const cell = (col, r, text, style) =>
    `<c r="${col}${r}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t xml:space="preserve">${xmlEsc(text)}</t></is></c>`;

  let sheetRows = '';
  let r = 1;
  sheetRows += `<row r="${r}">${cell('A', r, `${clubName || 'ক্লাব'} — ব্লাড ডোনার লিস্ট`, 1)}</row>`;
  r += 1;
  sheetRows += `<row r="${r}">${header.map((h, i) => cell(colLetters[i], r, h, 1)).join('')}</row>`;
  rows.forEach((d, idx) => {
    r += 1;
    const vals = [String(idx + 1), d.name || '', d.blood_group || '', d.phone || '', d.upazila || ''];
    sheetRows += `<row r="${r}">${vals.map((v, i) => cell(colLetters[i], r, v)).join('')}</row>`;
  });

  const sheet =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<cols><col min="1" max="1" width="6" customWidth="1"/><col min="2" max="2" width="28" customWidth="1"/>` +
    `<col min="3" max="3" width="14" customWidth="1"/><col min="4" max="4" width="18" customWidth="1"/>` +
    `<col min="5" max="5" width="16" customWidth="1"/></cols>` +
    `<sheetData>${sheetRows}</sheetData></worksheet>`;

  const styles =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
    `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
    `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
    `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>` +
    `</styleSheet>`;

  const files = [
    {
      name: '[Content_Types].xml',
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        `</Types>`
      ),
    },
    {
      name: '_rels/.rels',
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
        `</Relationships>`
      ),
    },
    {
      name: 'xl/workbook.xml',
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        `<sheets><sheet name="Donors" sheetId="1" r:id="rId1"/></sheets></workbook>`
      ),
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
        `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        `</Relationships>`
      ),
    },
    { name: 'xl/styles.xml', data: enc.encode(styles) },
    { name: 'xl/worksheets/sheet1.xml', data: enc.encode(sheet) },
  ];

  return buildZip(files);
}

// ---------------- PDF (JPEG পেজ থেকে) ----------------
// pages: [{ jpeg: Uint8Array, width, height }] — প্রতিটা A4 পেজ জুড়ে বসে
export function buildPdf(pages) {
  const enc = new TextEncoder();
  const PW = 595.28;
  const PH = 841.89;
  const parts = [];
  const offsets = [];
  let length = 0;

  const push = (chunk) => {
    const bytes = typeof chunk === 'string' ? enc.encode(chunk) : chunk;
    parts.push(bytes);
    length += bytes.length;
  };
  const startObj = (n) => { offsets[n] = length; push(`${n} 0 obj\n`); };

  push('%PDF-1.4\n');

  // অবজেক্ট নম্বর: 1 Catalog, 2 Pages, তারপর প্রতি পেজে ৩টা (Page, Image, Content)
  const kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
  startObj(1); push('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  startObj(2); push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>\nendobj\n`);

  pages.forEach((p, i) => {
    const pageN = 3 + i * 3;
    const imgN = pageN + 1;
    const contN = pageN + 2;
    startObj(pageN);
    push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PW} ${PH}] /Resources << /XObject << /Im0 ${imgN} 0 R >> >> /Contents ${contN} 0 R >>\nendobj\n`);
    startObj(imgN);
    push(`<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`);
    push(p.jpeg);
    push('\nendstream\nendobj\n');
    const content = `q ${PW} 0 0 ${PH} 0 0 cm /Im0 Do Q`;
    startObj(contN);
    push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);
  });

  const objCount = 2 + pages.length * 3;
  const xrefPos = length;
  let xref = `xref\n0 ${objCount + 1}\n0000000000 65535 f \n`;
  for (let n = 1; n <= objCount; n++) xref += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  push(xref);
  push(`trailer\n<< /Size ${objCount + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`);

  return concatBytes(parts);
}

// ---------------- ক্যানভাসে লিস্ট আঁকা (ছবি ও PDF দুটোর জন্য) ----------------
const FONT = '"Noto Sans Bengali","Hind Siliguri","Siyam Rupali",system-ui,sans-serif';
const PAGE_W = 1240;
const PAGE_H = 1754; // A4 @150dpi
const TITLE_H = 200;
const HEAD_H = 60;
const ROW_H = 64;
const FOOT_H = 60;
const ROWS_PER_PAGE = Math.floor((PAGE_H - TITLE_H - HEAD_H - FOOT_H) / ROW_H);

function drawPage(rows, startIndex, count, total, clubName, pageNo, pageCount, fixedHeight) {
  const height = fixedHeight || PAGE_H;
  const canvas = document.createElement('canvas');
  canvas.width = PAGE_W;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, PAGE_W, height);

  // টাইটেল বার
  ctx.fillStyle = '#1B2A4A';
  ctx.fillRect(0, 0, PAGE_W, TITLE_H - 40);
  ctx.fillStyle = '#FF6B35';
  ctx.fillRect(0, TITLE_H - 40, PAGE_W, 8);

  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `700 46px ${FONT}`;
  ctx.fillText(clubName || 'ক্লাব', 60, 62);
  ctx.font = `500 30px ${FONT}`;
  ctx.fillStyle = '#FFD3BC';
  ctx.fillText(`ব্লাড ডোনার লিস্ট · মোট ${total} জন · ${dateLabel()}`, 60, 118);

  // টেবিল হেডার
  const colX = { no: 60, name: 140, group: 640, phone: 800, upazila: 1040 };
  const headY = TITLE_H;
  ctx.fillStyle = '#FFF0EA';
  ctx.fillRect(40, headY, PAGE_W - 80, HEAD_H);
  ctx.fillStyle = '#1B2A4A';
  ctx.font = `700 28px ${FONT}`;
  ctx.fillText('নং', colX.no, headY + HEAD_H / 2);
  ctx.fillText('নাম', colX.name, headY + HEAD_H / 2);
  ctx.fillText('গ্রুপ', colX.group, headY + HEAD_H / 2);
  ctx.fillText('ফোন', colX.phone, headY + HEAD_H / 2);
  ctx.fillText('উপজেলা', colX.upazila, headY + HEAD_H / 2);

  const fit = (text, maxW) => {
    let t = String(text ?? '');
    if (ctx.measureText(t).width <= maxW) return t;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    return t + '…';
  };

  for (let i = 0; i < count; i++) {
    const d = rows[startIndex + i];
    const y = headY + HEAD_H + i * ROW_H;
    if (i % 2 === 1) {
      ctx.fillStyle = '#F8FAFC';
      ctx.fillRect(40, y, PAGE_W - 80, ROW_H);
    }
    const cy = y + ROW_H / 2;
    ctx.fillStyle = '#5A6E85';
    ctx.font = `500 26px ${FONT}`;
    ctx.fillText(String(startIndex + i + 1), colX.no, cy);
    ctx.fillStyle = '#1B2A4A';
    ctx.font = `600 28px ${FONT}`;
    ctx.fillText(fit(d.name, 470), colX.name, cy);
    ctx.fillStyle = '#D14343';
    ctx.font = `700 28px ${FONT}`;
    ctx.fillText(d.blood_group || '', colX.group, cy);
    ctx.fillStyle = '#1B2A4A';
    ctx.font = `500 28px ${FONT}`;
    ctx.fillText(d.phone || '', colX.phone, cy);
    ctx.fillText(fit(d.upazila || '', 170), colX.upazila, cy);
  }

  // ফুটার
  ctx.fillStyle = '#9AA8BC';
  ctx.font = `500 22px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText(`স্মার্ট ফেনী · smartfeni.com${pageCount > 1 ? ` · পাতা ${pageNo}/${pageCount}` : ''}`, PAGE_W / 2, height - FOOT_H / 2);

  return canvas;
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('ছবি বানানো যায়নি'))), type, quality);
  });
}

async function renderPng(rows, clubName) {
  const h = TITLE_H + HEAD_H + rows.length * ROW_H + FOOT_H;
  const canvas = drawPage(rows, 0, rows.length, rows.length, clubName, 1, 1, Math.max(h, 600));
  return canvasToBlob(canvas, 'image/png');
}

async function renderPdf(rows, clubName) {
  const pageCount = Math.max(1, Math.ceil(rows.length / ROWS_PER_PAGE));
  const pages = [];
  for (let p = 0; p < pageCount; p++) {
    const start = p * ROWS_PER_PAGE;
    const count = Math.min(ROWS_PER_PAGE, rows.length - start);
    const canvas = drawPage(rows, start, count, rows.length, clubName, p + 1, pageCount, 0);
    const blob = await canvasToBlob(canvas, 'image/jpeg', 0.92);
    pages.push({ jpeg: new Uint8Array(await blob.arrayBuffer()), width: PAGE_W, height: PAGE_H });
  }
  return buildPdf(pages);
}

// ---------------- সেভ/ডাউনলোড ----------------
function bytesToBase64(bytes) {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function browserDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function saveFile(blob, filename) {
  if (isNativeApp()) {
    try {
      const { Filesystem, Directory } = await import('@capacitor/filesystem');
      const bytes = new Uint8Array(await blob.arrayBuffer());
      await Filesystem.writeFile({
        path: `SmartFeni/${filename}`,
        data: bytesToBase64(bytes),
        directory: Directory.Documents,
        recursive: true,
      });
      return 'native';
    } catch (err) {
      // নেটিভ সেভ না হলে ব্রাউজার-ধরনের ডাউনলোড চেষ্টা (WebView-তে কাজ নাও করতে পারে)
    }
  }
  browserDownload(blob, filename);
  return 'browser';
}

// format: 'pdf' | 'png' | 'xlsx'
export async function downloadDonorList(format, donors, clubName) {
  const rows = sortedRows(donors);
  if (rows.length === 0) throw new Error('লিস্ট খালি');

  if (document.fonts?.ready) {
    try { await document.fonts.ready; } catch (e) { /* ফন্ট অপেক্ষা ফেইল হলেও এগোবে */ }
  }

  const stamp = fileStamp();
  let blob;
  let filename;
  if (format === 'png') {
    blob = await renderPng(rows, clubName);
    filename = `blood-donors-${stamp}.png`;
  } else if (format === 'pdf') {
    blob = new Blob([await renderPdf(rows, clubName)], { type: 'application/pdf' });
    filename = `blood-donors-${stamp}.pdf`;
  } else {
    blob = new Blob([buildXlsx(rows, clubName)], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    filename = `blood-donors-${stamp}.xlsx`;
  }

  const where = await saveFile(blob, filename);
  return { filename, where };
}
