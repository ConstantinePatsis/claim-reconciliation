"""
Generates synthetic invoice images (PNG) + a ground-truth manifest for the
extraction eval suite. Not part of the app build — run manually to regenerate
the fixtures under public/eval-fixtures/.

Usage: python3 eval/generate_fixtures.py
"""

import json
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

random.seed(42)

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "public" / "eval-fixtures"
OUT_DIR.mkdir(parents=True, exist_ok=True)

ARIAL = "/System/Library/Fonts/Supplemental/Arial.ttf"
ARIAL_BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
COURIER = "/System/Library/Fonts/Supplemental/Courier New.ttf"

W, H = 850, 1100

RETAILERS = [
    "Trader Joe's", "Whole Foods Market", "Costco Wholesale", "Target Corporation",
    "Kroger Co.", "Safeway Inc.", "Publix Super Markets", "Albertsons Companies",
    "Sprouts Farmers Market", "Wegmans Food Markets", "H-E-B Grocery", "Meijer Inc.",
    "Giant Eagle", "Stop & Shop", "Food Lion", "Aldi Inc.", "Hy-Vee", "Vons",
]

PRODUCTS = [
    "Organic Almond Milk 32oz", "Free-Range Eggs Dozen", "Sourdough Bread Loaf",
    "Sparkling Water 12-pack", "Greek Yogurt 32oz", "Ground Coffee 12oz Bag",
    "Cheddar Cheese Block 8oz", "Frozen Blueberries 16oz", "Olive Oil 500ml",
    "Granola Bars 6-pack", "Paper Towels 6-roll", "Dish Soap 24oz",
    "Pasta Sauce 24oz Jar", "Whole Wheat Pasta 16oz", "Trail Mix 10oz Bag",
    "Orange Juice 64oz", "Chicken Breast 5lb Pack", "Brown Rice 5lb Bag",
]

MONTHS = [
    "January", "February", "March", "April", "May", "June", "July", "August",
    "September", "October", "November", "December",
]


def rand_date():
    y = random.choice([2025, 2026])
    m = random.randint(1, 9 if y == 2026 else 12)
    d = random.randint(1, 28)
    return y, m, d


def iso(y, m, d):
    return f"{y:04d}-{m:02d}-{d:02d}"


def fmt_date(y, m, d, style):
    if style == "iso":
        return iso(y, m, d)
    if style == "us_slash":
        return f"{m:02d}/{d:02d}/{y:04d}"
    if style == "long":
        return f"{MONTHS[m - 1]} {d}, {y}"
    if style == "dmy_dash":
        return f"{d:02d}-{MONTHS[m - 1][:3]}-{y:04d}"
    raise ValueError(style)


def font(path, size):
    return ImageFont.truetype(path, size)


def draw_field(draw, x, y, label, value, label_font, value_font, label_color="#555555", value_color="#111111"):
    draw.text((x, y), label, font=label_font, fill=label_color)
    draw.text((x + 190, y), value, font=value_font, fill=value_color)


def render_invoice(spec):
    img = Image.new("RGB", (W, H), "white")
    draw = ImageDraw.Draw(img)

    body_font_path = COURIER if spec.get("mono") else ARIAL
    title = spec.get("title", "INVOICE")
    label_font = font(body_font_path, 20)
    value_font = font(body_font_path, 20)
    header_font = font(ARIAL_BOLD, 34)
    retailer_font = font(ARIAL_BOLD, 26)

    draw.rectangle([40, 40, W - 40, H - 40], outline="#cccccc", width=2)

    draw.text((70, 70), title, font=header_font, fill="#111111")
    draw.line([(70, 120), (W - 70, 120)], fill="#dddddd", width=2)

    y = 160
    draw.text((70, y), spec["retailer"], font=retailer_font, fill="#111111")
    y += 55

    draw.text((70, y), f"Invoice #: {spec['invoice_no']}", font=label_font, fill="#555555")
    y += 45

    labels = spec["labels"]
    fields = spec["fields_order"]
    for field in fields:
        if field in spec["omit"]:
            continue
        if field == "product":
            draw_field(draw, 70, y, labels["product"], spec["product"], label_font, value_font)
        elif field == "units_shipped":
            draw_field(draw, 70, y, labels["units_shipped"], str(spec["units_shipped"]), label_font, value_font)
        elif field == "price_per_unit":
            draw_field(draw, 70, y, labels["price_per_unit"], f"${spec['price_per_unit']:.2f}", label_font, value_font)
        elif field == "invoice_date":
            draw_field(draw, 70, y, labels["invoice_date"], spec["display_date"], label_font, value_font)
        y += 45

    y += 30
    draw.line([(70, y), (W - 70, y)], fill="#dddddd", width=2)
    y += 30
    footer_font = font(ARIAL, 16)
    draw.text((70, y), "Thank you for your business.", font=footer_font, fill="#999999")

    if spec.get("noisy"):
        noise = Image.effect_noise((W, H), 28).convert("L")
        noisy_rgb = Image.merge("RGB", (noise, noise, noise))
        img = Image.blend(img, noisy_rgb, alpha=0.12)

    if spec.get("rotate"):
        img = img.rotate(spec["rotate"], expand=True, fillcolor="white")

    return img


def build_specs():
    specs = []
    date_styles = ["iso", "us_slash", "long", "dmy_dash"]
    default_labels = {
        "product": "Product:",
        "units_shipped": "Units Shipped:",
        "price_per_unit": "Price / Unit:",
        "invoice_date": "Invoice Date:",
    }
    alt_labels = {
        "product": "Item:",
        "units_shipped": "Qty Shipped:",
        "price_per_unit": "Unit Cost:",
        "invoice_date": "Ship Date:",
    }

    def base(i, **overrides):
        y, m, d = rand_date()
        date_style = overrides.pop("date_style", "iso")
        spec = {
            "id": f"inv_{i:02d}",
            "invoice_no": f"INV-{1000 + i}",
            "retailer": RETAILERS[i % len(RETAILERS)],
            "product": PRODUCTS[i % len(PRODUCTS)],
            "units_shipped": random.randint(20, 800),
            "price_per_unit": round(random.uniform(0.75, 45.0), 2),
            "y": y, "m": m, "d": d,
            "display_date": fmt_date(y, m, d, date_style),
            "labels": default_labels,
            "fields_order": ["product", "units_shipped", "price_per_unit", "invoice_date"],
            "omit": [],
            "title": "INVOICE",
        }
        spec.update(overrides)
        return spec

    # 1-6: clean, standard layout, varied retailers/products/prices
    for i in range(1, 7):
        specs.append(base(i))

    # 7-10: alternate field labels (semantic understanding, not label matching)
    for i in range(7, 11):
        specs.append(base(i, labels=alt_labels, title="PACKING SLIP"))

    # 11-13: unusual date formats
    specs.append(base(11, date_style="us_slash"))
    specs.append(base(12, date_style="long"))
    specs.append(base(13, date_style="dmy_dash"))

    # 14-15: missing field (ground truth null for the omitted field)
    s14 = base(14, omit=["invoice_date"])
    specs.append(s14)
    s15 = base(15, omit=["product"])
    specs.append(s15)

    # 16-17: noisy scan-like image
    specs.append(base(16, noisy=True, mono=True))
    specs.append(base(17, noisy=True))

    # 18: rotated/skewed scan
    specs.append(base(18, rotate=3.5))

    return specs


def main():
    specs = build_specs()
    manifest = []

    for spec in specs:
        img = render_invoice(spec)
        filename = f"{spec['id']}.png"
        img.save(OUT_DIR / filename)

        expected = {
            "retailer": spec["retailer"],
            "product": None if "product" in spec["omit"] else spec["product"],
            "units_shipped": None if "units_shipped" in spec["omit"] else spec["units_shipped"],
            "price_per_unit": None if "price_per_unit" in spec["omit"] else spec["price_per_unit"],
            "invoice_date": None if "invoice_date" in spec["omit"] else iso(spec["y"], spec["m"], spec["d"]),
        }
        manifest.append({"file": filename, "expected": expected})
        print(f"wrote {filename}: {spec['retailer']} / {expected['product']}")

    with open(OUT_DIR / "ground-truth.json", "w") as f:
        json.dump(manifest, f, indent=2)

    print(f"\n{len(manifest)} fixtures written to {OUT_DIR}")


if __name__ == "__main__":
    main()
