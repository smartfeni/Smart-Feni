import json

input_file = "geoBoundaries-BGD-ADM4_simplified.geojson"
output_file = "feni_unions.geojson"

# ফেনী জেলার ৪৩টি ইউনিয়ন + ৫টি পৌরসভা (ইংরেজি নাম)
feni_names = [
    # ছাগলনাইয়া উপজেলা (৫টি ইউনিয়ন + ১টি পৌরসভা)
    "Radhanagar", "Pathan Nagar", "Shubhapur", "Ghopal", "Mahamaya",
    "Chhagalnaiya Paurashava",
    # দাগনভূঁইয়া উপজেলা (৮টি ইউনিয়ন + ১টি পৌরসভা)
    "Sindurpur", "Rajapur", "Purba Chandrapur", "Ramnagar", "Yakubpur",
    "Daganbhuiyan Sadar", "Matubhuiyan", "Jaylaskar",
    "Daganbhuiyan Paurashava",
    # পরশুরাম উপজেলা (৩টি ইউনিয়ন + ১টি পৌরসভা)
    "Mirzanagar", "Chithalia", "Boxmahmud",
    "Parshuram Paurashava",
    # ফুলগাজী উপজেলা (৬টি ইউনিয়ন)
    "Fulgazi", "Munsirhat", "Darbarpur", "Anandapur", "GM Hat", "Amjadhat",
    # ফেনী সদর উপজেলা (১২টি ইউনিয়ন + ১টি পৌরসভা)
    "Sharshadi", "Panchgachia", "Dharmapur", "Kazirbag", "Kaliddah", "Baligaon",
    "Dhalia", "Lemua", "Chhanua", "Matabi", "Fazilpur", "Farhadnagar",
    "Feni Paurashava",
    # সোনাগাজী উপজেলা (৯টি ইউনিয়ন + ১টি পৌরসভা)
    "Char Majlishpur", "Bagadana", "Mangalkandi", "Matiganj", "Char Darbesh",
    "Char Chandia", "Sonagazi Sadar", "Amirabad", "Nababpur",
    "Sonagazi Paurashava",
]

with open(input_file, "r", encoding="utf-8") as f:
    data = json.load(f)

feni_features = []
found_names = set()
for feature in data.get("features", []):
    name = feature.get("properties", {}).get("shapeName", "")
    if name in feni_names:
        feni_features.append(feature)
        found_names.add(name)

output = {
    "type": "FeatureCollection",
    "features": feni_features
}

with open(output_file, "w", encoding="utf-8") as f:
    json.dump(output, f, ensure_ascii=False, indent=2)

print(f"✅ মোট {len(feni_features)}টি ফিচার পাওয়া গেছে।")
print(f"📋 খুঁজে পাওয়া নাম: {len(found_names)}টি")
print()

# কোন নামগুলো পাওয়া যায়নি দেখাও
missing = set(feni_names) - found_names
if missing:
    print("⚠️ যেসব নাম খুঁজে পাওয়া যায়নি:")
    for m in sorted(missing):
        print(f"  - {m}")
else:
    print("🎉 সব নাম খুঁজে পাওয়া গেছে!")
