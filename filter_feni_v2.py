import json

input_file = "geoBoundaries-BGD-ADM4_simplified.geojson"
output_file = "feni_unions.geojson"

# বাউন্ডিং বক্স আরেকটু বড় করা হলো
FENI_LON_MIN = 91.15
FENI_LON_MAX = 91.60
FENI_LAT_MIN = 22.70
FENI_LAT_MAX = 23.30

# ফেনীর ৪৩টি ইউনিয়ন + ৫টি পৌরসভার সঠিক নাম
feni_names = [
    # ছাগলনাইয়া (৫ + ১)
    "Radhanagar", "Pathannagar", "Shubhapur", "Gopal", "Mohamaya",
    "Chhagalnaiya Paurashava",
    # দাগনভূঁইয়া (৮ + ১)
    "Sindurpur", "Rajapur", "Purba Chandrapur", "Ramnagar", "Yakubpur",
    "Daganbhuiyan", "Mathu Bhuiyan", "Jailashkara",
    "Daganbhuiyan Paurashava",
    # পরশুরাম (৩ + ১)
    "Mirzanagar", "Chithalia", "Baksh Mohammad",
    "Parshuram Paurashava",
    # ফুলগাজী (৬)
    "Fulgazi", "Munshirhat", "Darbarpur", "Anandapur", "G.M.Hat", "Amjadhat",
    # ফেনী সদর (১২ + ১)
    "Sharsha", "Panchgachhiya", "Dharmapur", "Kazirbag", "Kalidah", "Baligaon",
    "Dhalia", "Lemua", "Chhanua", "Matabi", "Fazilpur", "Farhadnagar",
    "Feni Paurashava",
    # সোনাগাজী (৯ + ১)
    "Char Majlishpur", "Bagadana", "Mangalkandi", "Matiganj", "Char Darbesh",
    "Char Chandia", "Sonagazi", "Amirabad", "Nawabpur",
    "Sonagazi Paurashava",
]

def get_first_point(feature):
    geom = feature.get("geometry", {})
    coords = geom.get("coordinates", [])
    if not coords:
        return None
    if geom["type"] == "Polygon":
        return coords[0][0]
    elif geom["type"] == "MultiPolygon":
        return coords[0][0][0]
    return None

with open(input_file, "r", encoding="utf-8") as f:
    data = json.load(f)

feni_features = []
used_names = set()

for feature in data.get("features", []):
    props = feature.get("properties", {})
    name = props.get("shapeName", "")

    if name not in feni_names:
        continue
    # একই নাম দুইবার না নেওয়া
    if name in used_names:
        continue

    pt = get_first_point(feature)
    if pt is None:
        continue

    lon, lat = pt[0], pt[1]
    if FENI_LON_MIN < lon < FENI_LON_MAX and FENI_LAT_MIN < lat < FENI_LAT_MAX:
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

# বাদ পড়া নাম দেখাও
missing = set(feni_names) - used_names
if missing:
    print("⚠️ এখনো বাদ পড়েছে:")
    for m in sorted(missing):
        print(f"  - {m}")
else:
    print("🎉 সব ৪৮টি (৪৩ ইউনিয়ন + ৫ পৌরসভা) পাওয়া গেছে!")
