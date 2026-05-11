# passport.py
# MONEY VERSION
# ưu tiên: tự nhiên - sạch - user chịu trả tiền
# pip install requests rembg opencv-python pillow numpy

import os
import sys
import io
import cv2
import numpy as np
import requests
from rembg import remove
from PIL import Image, ImageEnhance, ImageFilter

# ==========================================
# CONFIG
# ==========================================
FACEPP_KEY = os.getenv("FACEPP_KEY", "").strip()
FACEPP_SECRET = os.getenv("FACEPP_SECRET", "").strip()
HF_TOKEN = os.getenv("HF_TOKEN", "").strip()

inp = sys.argv[1]
outp = sys.argv[2]

# ==========================================
# READ
# ==========================================
img_bgr = cv2.imread(inp)

if img_bgr is None:
    raise Exception("Cannot read image")

h, w = img_bgr.shape[:2]

# ==========================================
# FACE DETECT (Face++)
# ==========================================
fx = int(w * 0.30)
fy = int(h * 0.14)
fw = int(w * 0.40)
fh = int(h * 0.28)

try:
    if FACEPP_KEY and FACEPP_SECRET:

        url = "https://api-us.faceplusplus.com/facepp/v3/detect"

        with open(inp, "rb") as f:
            r = requests.post(
                url,
                files={"image_file": f},
                data={
                    "api_key": FACEPP_KEY,
                    "api_secret": FACEPP_SECRET
                },
                timeout=25
            ).json()

        if "faces" in r and r["faces"]:
            rect = r["faces"][0]["face_rectangle"]

            fx = rect["left"]
            fy = rect["top"]
            fw = rect["width"]
            fh = rect["height"]

except:
    pass

# ==========================================
# REMOVE BG
# HF -> LOCAL
# ==========================================
img_rgba = None

# HuggingFace first
try:
    if HF_TOKEN:

        url = (
            "https://api-inference.huggingface.co/models/"
            "briaai/RMBG-1.4"
        )

        rr = requests.post(
            url,
            headers={
                "Authorization":
                f"Bearer {HF_TOKEN}"
            },
            data=open(inp, "rb").read(),
            timeout=120
        )

        if rr.status_code == 200:

            rgba = Image.open(
                io.BytesIO(rr.content)
            ).convert("RGBA")

            arr = np.array(rgba)

            img_rgba = cv2.cvtColor(
                arr,
                cv2.COLOR_RGBA2BGRA
            )

except:
    pass

# fallback local rembg
if img_rgba is None:

    with open(inp, "rb") as f:
        cut = remove(f.read())

    rgba = Image.open(
        io.BytesIO(cut)
    ).convert("RGBA")

    arr = np.array(rgba)

    img_rgba = cv2.cvtColor(
        arr,
        cv2.COLOR_RGBA2BGRA
    )

# ==========================================
# SOFT ALPHA ONLY (NO HARD CUT)
# ==========================================
alpha = img_rgba[:, :, 3]

alpha = cv2.GaussianBlur(
    alpha,
    (0,0),
    2.2
)

alpha = cv2.normalize(
    alpha,
    None,
    0,
    255,
    cv2.NORM_MINMAX
)

alpha[alpha < 10] = 0
alpha[alpha > 250] = 255

img_rgba[:, :, 3] = alpha

# ==========================================
# REMOVE SMALL FLOATING OBJECTS
# (hoa, vật bay trên đầu)
# ==========================================
num, labels, stats, _ = cv2.connectedComponentsWithStats(
    alpha,
    8
)

clean = np.zeros_like(alpha)

main_area = 0
main_id = 1

for i in range(1, num):
    area = stats[i, cv2.CC_STAT_AREA]
    if area > main_area:
        main_area = area
        main_id = i

# giữ object lớn nhất (người)
clean[labels == main_id] = alpha[labels == main_id]

img_rgba[:, :, 3] = clean
alpha = clean

# ==========================================
# SMART BODY BOX
# ==========================================
ys, xs = np.where(alpha > 12)

if len(xs) > 0:
    minx = xs.min()
    maxx = xs.max()
    miny = ys.min()
    maxy = ys.max()
else:
    minx = 0
    maxx = w
    miny = 0
    maxy = h

body_w = maxx - minx
body_h = maxy - miny

cx = (minx + maxx) / 2

crop_w = int(body_w * 1.28)
crop_h = int(crop_w * 1.5)

left = int(cx - crop_w / 2)
top = int(miny - body_h * 0.08)

left = max(0, left)
top = max(0, top)

crop_w = min(crop_w, w - left)
crop_h = min(crop_h, h - top)

person = img_rgba[
    top:top+crop_h,
    left:left+crop_w
]

# ==========================================
# NATURAL WHITE BG
# ==========================================
alpha = person[:,:,3].astype(np.float32) / 255.0
rgb = person[:,:,:3].astype(np.float32)

white = np.ones_like(rgb) * 255

# anti halo blend
mix = alpha ** 0.82

out = np.zeros_like(rgb)

for c in range(3):
    out[:,:,c] = (
        rgb[:,:,c] * mix +
        white[:,:,c] * (1 - mix)
    )

out = np.clip(
    out,
    0,
    255
).astype(np.uint8)

# ==========================================
# 4x6 CANVAS
# ==========================================
canvas_w = 1200
canvas_h = 1800

oh, ow = out.shape[:2]

scale = min(
    canvas_w * 0.88 / ow,
    canvas_h * 0.90 / oh
)

nw = int(ow * scale)
nh = int(oh * scale)

out = cv2.resize(
    out,
    (nw, nh),
    interpolation=cv2.INTER_CUBIC
)

canvas = np.ones(
    (canvas_h, canvas_w, 3),
    dtype=np.uint8
) * 255

x0 = (canvas_w - nw) // 2
y0 = int((canvas_h - nh) * 0.13)

canvas[
    y0:y0+nh,
    x0:x0+nw
] = out

# ==========================================
# BEAUTY LIGHT
# ==========================================
pil = Image.fromarray(
    cv2.cvtColor(
        canvas,
        cv2.COLOR_BGR2RGB
    )
)

pil = pil.filter(
    ImageFilter.GaussianBlur(0.12)
)

pil = ImageEnhance.Brightness(
    pil
).enhance(1.04)

pil = ImageEnhance.Contrast(
    pil
).enhance(1.03)

pil = pil.filter(
    ImageFilter.UnsharpMask(
        radius=0.9,
        percent=118
    )
)

pil.save(
    outp,
    quality=100
)

print(outp)