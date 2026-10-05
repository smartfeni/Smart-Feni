import json

input_file = "geoBoundaries-BGD-ADM4_simplified.geojson"
output_file = "feni_unions.geojson"

# ফেনী জেলার GeoJSON-এ প্রাপ্ত সঠিক ৪৮টি নাম
feni_names = [
    # ছাগলনাইয়া (৫)
    "Radhanagar", "Pathannagar", "Shubhapur", "Gopal", "Mohamaya",
    "Chhagalnaiya Paurashava",
    # দাগনভূঁইয়া (৮)
    "Sindurpur", "Rajapur", "Purba Chandrapur", "Ramnagar", "Yakubpur",
    "Daganbhuiyan", "Mathu Bhuiyan", "Jailashkara",
    "Daganbhuiyan Paurashava",
    # পরশুরাম (৩)
    "Mirzanagar", "Chithalia", "Baksh Mohammad",
    "Parshuram Paurashava",
    # ফুলগাজী (৬)
    "Fulgazi", "Munshirhat", "Darbarpur", "Anandapur", "G.M.Hat", "Amjadhat",
    # ফেনী সদর (১২) — Sanua = ছনুয়া, Sarishadi = শর্শদি
    "Sarishadi", "Panchgachhiya", "Dharmapur", "Kazirbag", "Kalidah", "Baligaon",
    "Dhalia", "Lemua", "Sanua", "Matabi", "Fazilpur", "Farhadnagar",
    "Feni Paurashava",
    # সোনাগাজী (৯)
    "Char Majlishpur", "Bagadana", "Mangalkandi", "Matiganj", "Char Darbesh",
    "Char Chandia", "Sonagazi", "Amirabad", "Nawabpur",
    "Sonagazi Paurashava",
]

with open(input_file, "r", encoding="utf-8") as f:
    data = json.load(f)

feni_features = []
used_names = set()

for feature in data.get("features", []):
    name = feature.get("properties", {}).get("shapeName", "")
    if name in feni_names and name not in used_names:
        feni_features.append(feature)
        used_names.add(name)

output = {
    "type": "FeatureCollection",
    "features": feni_features,
}

with open(output_file, "w", encoding="utf-8") as f:
    json.dump(output, f, ensure_ascii=False, indent=2)

print(f"✅ মোট {len(feni_features)}টি ফিচার পাওয়া গেছে।")
print()
missing = set(feni_names) - used_names
if missing:
    print("⚠️ বাদ পড়েছে:")
    for m in sorted(missing):
        print(f"  - {m}")
else:
    print("🎉 ফেনী জেলার ৪৩টি ইউনিয়ন + ৫টি পৌরসভা = ৪৮টি — সবই পাওয়া গেছে!")
