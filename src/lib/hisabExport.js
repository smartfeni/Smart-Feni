// ============================================================
// হিসাব — Excel (.xlsx) এক্সপোর্ট (/admin/hisab)
// দুটো শিট: ১) দৈনিক হিসাব  ২) সব এন্ট্রি
// কোনো বাইরের লাইব্রেরি নেই; ছোট .xlsx donorExport.js-এর buildZip দিয়ে বানানো।
// অ্যাপের ভেতরে ফাইল যায় ফোনের Documents/SmartFeni ফোল্ডারে, ব্রাউজারে সাধারণ ডাউনলোড।
// ============================================================

import { buildZip } from './donorExport.js';
import { isNativeApp } from './native-bridge.js';

const TYPE_LABEL = { joma: 'জমা', income: 'আয়', expense: 'খরচ' };

function xmlEsc(s) {
  return String(s ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const COLS = 'ABCDEFGHIJ'.split('');

// স্টাইল: ০ সাধারণ, ১ বোল্ড, ২ টাকা (#,##0.00), ৩ বোল্ড টাকা
const textCell = (c, r, text, style) =>
  `<c r="${COLS[c]}${r}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t xml:space="preserve">${xmlEsc(text)}</t></is></c>`;
const numCell = (c, r, n, style) =>
  `<c r="${COLS[c]}${r}" s="${style || 2}"><v>${Number(n) || 0}</v></c>`;

function sheetXml(widths, rowsXml) {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="2" topLeftCell="A3" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` +
    `<sheetData>${rowsXml}</sheetData></worksheet>`
  );
}

// daily: [{day, opening, joma, income, expense, closing}] · entries: [{id, entry_at_label, entry_date, type, category, amount, note, status}]
export function buildHisabXlsx({ title, daily, entries }) {
  const enc = new TextEncoder();

  // ---- শিট ১: দৈনিক হিসাব ----
  const dHead = ['তারিখ', 'আগের ব্যালেন্স', 'জমা', 'আয়', 'খরচ', 'দিন শেষে ব্যালেন্স'];
  let r = 1;
  let rows1 = `<row r="${r}">${textCell(0, r, `${title} — দৈনিক হিসাব`, 1)}</row>`;
  r += 1;
  rows1 += `<row r="${r}">${dHead.map((h, i) => textCell(i, r, h, 1)).join('')}</row>`;
  (daily || []).forEach((d) => {
    r += 1;
    rows1 +=
      `<row r="${r}">` +
      textCell(0, r, d.day) +
      numCell(1, r, d.opening) + numCell(2, r, d.joma) + numCell(3, r, d.income) +
      numCell(4, r, d.expense) + numCell(5, r, d.closing) +
      `</row>`;
  });
  if (daily && daily.length) {
    r += 1;
    const sum = (k) => daily.reduce((n, d) => n + (Number(d[k]) || 0), 0);
    rows1 +=
      `<row r="${r}">` +
      textCell(0, r, 'মোট', 1) +
      numCell(1, r, daily[0].opening, 3) + numCell(2, r, sum('joma'), 3) + numCell(3, r, sum('income'), 3) +
      numCell(4, r, sum('expense'), 3) + numCell(5, r, daily[daily.length - 1].closing, 3) +
      `</row>`;
  }
  const sheet1 = sheetXml([14, 18, 14, 14, 14, 20], rows1);

  // ---- শিট ২: সব এন্ট্রি ----
  const eHead = ['সিরিয়াল', 'তারিখ', 'সময়', 'ধরন', 'খাত', 'পরিমাণ', 'নোট', 'অবস্থা'];
  r = 1;
  let rows2 = `<row r="${r}">${textCell(0, r, `${title} — সব এন্ট্রি`, 1)}</row>`;
  r += 1;
  rows2 += `<row r="${r}">${eHead.map((h, i) => textCell(i, r, h, 1)).join('')}</row>`;
  (entries || []).forEach((e) => {
    r += 1;
    rows2 +=
      `<row r="${r}">` +
      numCell(0, r, e.id, 0) +
      textCell(1, r, e.entry_date) +
      textCell(2, r, e.time_label || '') +
      textCell(3, r, TYPE_LABEL[e.type] || e.type) +
      textCell(4, r, e.category) +
      numCell(5, r, e.amount) +
      textCell(6, r, e.note || '') +
      textCell(7, r, e.status === 'cancelled' ? 'বাতিল' : 'চালু') +
      `</row>`;
  });
  const sheet2 = sheetXml([10, 14, 14, 10, 24, 14, 36, 10], rows2);

  const styles =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
    `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
    `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="4">` +
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
    `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
    `<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>` +
    `<xf numFmtId="4" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>` +
    `</cellXfs></styleSheet>`;

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
        `<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
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
        `<sheets><sheet name="দৈনিক হিসাব" sheetId="1" r:id="rId1"/><sheet name="সব এন্ট্রি" sheetId="2" r:id="rId2"/></sheets></workbook>`
      ),
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: enc.encode(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
        `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>` +
        `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        `</Relationships>`
      ),
    },
    { name: 'xl/styles.xml', data: enc.encode(styles) },
    { name: 'xl/worksheets/sheet1.xml', data: enc.encode(sheet1) },
    { name: 'xl/worksheets/sheet2.xml', data: enc.encode(sheet2) },
  ];

  return buildZip(files);
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

// ফেরত: 'native' | 'browser'
export async function downloadHisabExcel(payload, filename) {
  const bytes = buildHisabXlsx(payload);
  const blob = new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  if (isNativeApp()) {
    try {
      const { Filesystem, Directory } = await import('@capacitor/filesystem');
      await Filesystem.writeFile({
        path: `SmartFeni/${filename}`,
        data: bytesToBase64(bytes),
        directory: Directory.Documents,
        recursive: true,
      });
      return 'native';
    } catch (err) {
      // নেটিভ সেভ না হলে ব্রাউজার-ধরনের ডাউনলোড চেষ্টা
    }
  }
  browserDownload(blob, filename);
  return 'browser';
}
