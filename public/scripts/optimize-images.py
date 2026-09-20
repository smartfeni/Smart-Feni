#!/usr/bin/env python3
# ============================================================
# ফাইল: scripts/optimize-images.py
# কাজ: Supabase Storage ('listing-images' বাকেট) এর বড় ছবি ছোট করে
#      একই পাথেই আবার আপলোড করা (তাই DB/ওয়েবসাইটের কোনো লিংক বদলাতে হয় না)
#      + ক্যাশ ১ বছর সেট করা।
#
# কেন লাগলো: প্রোফাইল ছবি গড়ে ১.১ MB (সর্বোচ্চ ৬ MB), ক্লাব কভার ~১ MB —
#            হেডারের ৩৬px আইকনের জন্যও এত বড় ছবি নামছিল, ক্যাশও ছিল ১ ঘণ্টা।
#
# নিরাপত্তা:
#   - ডিফল্টে কিছুই বদলায় না (শুধু রিপোর্ট)। সত্যিকারের কাজ করতে --apply দিন।
#   - --apply এ প্রতিটা ছবি বদলানোর আগে original 'storage-backup/' ফোল্ডারে সেভ হয়।
#   - ৯০% এর বেশি ছোট না হলে ছবিটা ছোঁয়াই হয় না; ছোট ছবি (< ২৫০KB) স্কিপ।
#   - বারবার চালালে সমস্যা নেই (ইতিমধ্যে ছোট ছবি আর বদলায় না)।
#
# প্রস্তুতি (Termux):
#   pkg install python-pillow            # (PC তে: pip install pillow)
#   read -rs SUPABASE_SERVICE_ROLE_KEY   # কী পেস্ট করে Enter (স্ক্রিনে দেখাবে না)
#   export SUPABASE_SERVICE_ROLE_KEY
#   echo "storage-backup/" >> .gitignore
#
# চালানো:
#   python scripts/optimize-images.py --limit 5     # ৫টা ছবিতে রিপোর্ট (টেস্ট)
#   python scripts/optimize-images.py               # সব ছবির রিপোর্ট (কিছু বদলায় না)
#   python scripts/optimize-images.py --apply       # সত্যিই ছোট করে আপলোড
#
# ⚠️ SUPABASE_SERVICE_ROLE_KEY গোপন — কোথাও কমিট/শেয়ার করবেন না।
# ============================================================

import io
import os
import sys
import json
import urllib.request
import urllib.error
from urllib.parse import quote

try:
    from PIL import Image, ImageOps
except ImportError:
    print("Pillow নেই। Termux: pkg install python-pillow   |   PC: pip install pillow")
    sys.exit(1)

SUPABASE_URL = (os.environ.get("PUBLIC_SUPABASE_URL") or "https://hedloawcvnbleehnurqd.supabase.co").rstrip("/")
SERVICE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
BUCKET = "listing-images"
BACKUP_DIR = os.path.join("storage-backup", BUCKET)

MIN_SIZE_BYTES = 250 * 1024   # এর ছোট ছবি ছোঁয়া হবে না
MIN_SAVING = 0.10             # কমপক্ষে ১০% ছোট না হলে ছবি বদলাবে না
JPEG_QUALITY = 80
CACHE_CONTROL = "max-age=31536000"
IMAGE_EXTS = (".jpg", ".jpeg", ".png", ".webp")

APPLY = "--apply" in sys.argv
LIMIT = None
if "--limit" in sys.argv:
    try:
        LIMIT = int(sys.argv[sys.argv.index("--limit") + 1])
    except (IndexError, ValueError):
        print("--limit এর পর একটা সংখ্যা দিন, যেমন: --limit 5")
        sys.exit(1)


def max_side_for(path):
    """পাথ দেখে ছবির সর্বোচ্চ দৈর্ঘ্য (px)। None = ছোঁবে না।"""
    p = path.lower()
    if p.startswith("site/") or p.startswith("screenshot-imports/"):
        return None                      # সাইটের ব্র্যান্ডিং/ইমপোর্ট ছবি — ছোঁবে না
    if p.startswith("avatars/"):
        return 400                       # প্রোফাইল ছবি
    if "logo" in p:
        return 512                       # ক্লাব/শপ লোগো
    return 1280                          # কভার, লিস্টিং, পোস্ট ইত্যাদি


def api(method, url, body=None, headers=None):
    h = {"Authorization": f"Bearer {SERVICE_KEY}", "apikey": SERVICE_KEY}
    if headers:
        h.update(headers)
    req = urllib.request.Request(url, data=body, headers=h, method=method)
    with urllib.request.urlopen(req, timeout=120) as resp:
        return resp.read()


def list_folder(prefix):
    """একটা ফোল্ডারের সব আইটেম (পেজ ধরে ধরে)।"""
    items, offset, page = [], 0, 100
    while True:
        payload = json.dumps({
            "prefix": prefix, "limit": page, "offset": offset,
            "sortBy": {"column": "name", "order": "asc"},
        }).encode()
        data = json.loads(api(
            "POST", f"{SUPABASE_URL}/storage/v1/object/list/{BUCKET}",
            payload, {"Content-Type": "application/json"},
        ))
        items.extend(data)
        if len(data) < page:
            return items
        offset += page


def walk(prefix=""):
    """সব ফাইল রিকার্সিভলি খুঁজে (path, size) দেয়।"""
    for it in list_folder(prefix):
        name = it.get("name")
        if not name:
            continue
        full = f"{prefix}{name}"
        if it.get("id") is None:          # ফোল্ডার
            yield from walk(full + "/")
        else:
            size = int((it.get("metadata") or {}).get("size") or 0)
            yield full, size


def resize_image(data, path, max_side):
    """(নতুন_bytes, mime) ফেরত দেয়; ছোট করা না গেলে None।"""
    ext = os.path.splitext(path.lower())[1]
    img = Image.open(io.BytesIO(data))
    img = ImageOps.exif_transpose(img)     # ফোনের ঘোরানো ছবি সোজা করে (রি-এনকোডে EXIF যায়)

    if max(img.size) > max_side:
        img.thumbnail((max_side, max_side), Image.LANCZOS)

    out = io.BytesIO()
    if ext in (".jpg", ".jpeg"):
        img.convert("RGB").save(out, "JPEG", quality=JPEG_QUALITY, optimize=True, progressive=True)
        mime = "image/jpeg"
    elif ext == ".webp":
        img.save(out, "WEBP", quality=JPEG_QUALITY, method=6)
        mime = "image/webp"
    elif ext == ".png":
        img.save(out, "PNG", optimize=True)
        mime = "image/png"
    else:
        return None
    return out.getvalue(), mime


def main():
    if not SERVICE_KEY:
        print("SUPABASE_SERVICE_ROLE_KEY সেট করা নেই। ফাইলের উপরের 'প্রস্তুতি' অংশ দেখুন।")
        sys.exit(1)

    mode = "সত্যিকারের কাজ (--apply)" if APPLY else "শুধু রিপোর্ট (কিছু বদলাচ্ছে না)"
    print(f"বাকেট: {BUCKET} · মোড: {mode}")
    print("ছবির তালিকা আনা হচ্ছে...")

    candidates = []
    for path, size in walk():
        if not path.lower().endswith(IMAGE_EXTS):
            continue
        limit_px = max_side_for(path)
        if limit_px is None or size < MIN_SIZE_BYTES:
            continue
        candidates.append((path, size, limit_px))

    candidates.sort(key=lambda c: -c[1])
    if LIMIT:
        candidates = candidates[:LIMIT]

    total_before = sum(c[1] for c in candidates)
    print(f"{len(candidates)}টা ছবি ছোট করার যোগ্য (মোট {total_before / 1048576:.1f} MB)\n")

    saved = changed = skipped = failed = 0
    for i, (path, size, limit_px) in enumerate(candidates, 1):
        tag = f"[{i}/{len(candidates)}] {path} ({size // 1024} KB)"
        try:
            original = api("GET", f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{quote(path)}")
            result = resize_image(original, path, limit_px)
            if result is None:
                print(f"{tag} → স্কিপ (অজানা ফরম্যাট)")
                skipped += 1
                continue
            new_data, mime = result

            if len(new_data) > len(original) * (1 - MIN_SAVING):
                print(f"{tag} → স্কিপ (বড় লাভ নেই: {len(new_data) // 1024} KB)")
                skipped += 1
                continue

            gain = len(original) - len(new_data)
            print(f"{tag} → {len(new_data) // 1024} KB (−{gain * 100 // len(original)}%)")

            if APPLY:
                backup_path = os.path.join(BACKUP_DIR, *path.split("/"))
                os.makedirs(os.path.dirname(backup_path), exist_ok=True)
                with open(backup_path, "wb") as f:
                    f.write(original)
                api(
                    "PUT", f"{SUPABASE_URL}/storage/v1/object/{BUCKET}/{quote(path)}", new_data,
                    {"Content-Type": mime, "cache-control": CACHE_CONTROL, "x-upsert": "true"},
                )
            saved += gain
            changed += 1
        except urllib.error.HTTPError as e:
            print(f"{tag} → ব্যর্থ: HTTP {e.code} {e.read()[:120]!r}")
            failed += 1
        except Exception as e:  # noqa: BLE001
            print(f"{tag} → ব্যর্থ: {e}")
            failed += 1

    verb = "ছোট করা হয়েছে" if APPLY else "ছোট করা যাবে"
    print(f"\nসারসংক্ষেপ: {changed}টা {verb}, {skipped}টা স্কিপ, {failed}টা ব্যর্থ")
    print(f"সাশ্রয়: {saved / 1048576:.1f} MB")
    if not APPLY:
        print("সব ঠিক দেখালে চালান: python scripts/optimize-images.py --apply")
    else:
        print(f"Original গুলো '{BACKUP_DIR}' ফোল্ডারে ব্যাকআপ আছে (কমিট করবেন না)।")


if __name__ == "__main__":
    main()