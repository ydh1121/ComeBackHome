#!/usr/bin/env python3
"""Isolated generated-glyph OCR comparison. Never reads a user schedule."""
import hashlib
import io
import json
import os
from pathlib import Path
import random
import resource
import subprocess
import sys
import tempfile
import time

from PIL import Image, ImageDraw, ImageFilter, ImageFont

MODEL = "korean_PP-OCRv5_mobile_rec"
FONT = Path("/usr/share/fonts/truetype/nanum/NanumGothic.ttf")
assert FONT.exists(), "Pinned Korean glyph font is missing"
random.seed(2061009)

# Generated targets are immutable across engines and browsers. Family C must
# not be used to tune parameters or code; its results are reported only.
SAMPLES = {
    "A": [("person", "강하현"), ("person", "정지윤"), ("person", "조도아"),
          ("date", "1일"), ("date", "2일"), ("date", "15일"),
          ("start", "09:00"), ("end", "18:00"), ("end", "22:30")],
    "B": [("person", "박민준"), ("person", "최서연"), ("person", "윤수빈"),
          ("date", "8일"), ("date", "12일"), ("date", "29일"),
          ("start", "08:30"), ("end", "19:30"), ("start", "13:00")],
    "C": [("person", "임태희"), ("person", "한채린"), ("person", "서유진"),
          ("date", "6일"), ("date", "17일"), ("date", "31일"),
          ("start", "10:30"), ("end", "20:00"), ("end", "23:30")],
}
def render(text, family):
    size = 25 if family == "A" else 21 if family == "B" else 18
    font = ImageFont.truetype(str(FONT), size)
    image = Image.new("RGB", (max(150, len(text)*size+44), 54), "white")
    draw = ImageDraw.Draw(image)
    draw.text((15, 10), text, font=font, fill=(18,18,18))
    if family == "B":
        image = image.resize((int(image.width*.82), 45), Image.Resampling.LANCZOS)
    if family == "C":
        image = image.rotate(2.0, fillcolor="white", expand=False)
        image = image.resize((int(image.width*.73), 38), Image.Resampling.BILINEAR)
        image = image.filter(ImageFilter.GaussianBlur(.48))
    return image

def string_from_result(result):
    value = getattr(result, "json", None)
    if callable(value):
        value = value()
    if isinstance(value, str):
        value = json.loads(value)
    if isinstance(value, dict):
        record = value.get("res", value)
        if isinstance(record, dict):
            return str(record.get("rec_text", "")), record.get("rec_score")
    return "", None

def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def metric(rows, engine, family, category):
    items = [x for x in rows if x["family"] == family and x["kind"] == category]
    return dict(correct=sum(x[engine]["exact"] for x in items), total=len(items),
                exact=sum(x[engine]["exact"] for x in items)/len(items) if items else None)

with tempfile.TemporaryDirectory(prefix="cbh_generated_ocr_") as temp:
    prepared = []
    for family, examples in SAMPLES.items():
        for index, (kind, expected) in enumerate(examples):
            path = Path(temp) / ("%s-%02d.png" % (family,index))
            image = render(expected, family)
            if family == "B":
                path = path.with_suffix(".jpg")
                image.save(path, quality=72)
            else:
                image.save(path)
            prepared.append(dict(family=family,kind=kind,expected=expected,
                                 path=str(path)))
    from paddleocr import TextRecognition
    begin=time.monotonic()
    predictor=TextRecognition(model_name=MODEL)
    load_ms=round((time.monotonic()-begin)*1000)
    for item in prepared:
        t0=time.monotonic()
        result=list(predictor.predict(input=item["path"], batch_size=1))
        paddle_ms=round((time.monotonic()-t0)*1000)
        paddle_text,score=string_from_result(result[0]) if result else ("",None)
        t0=time.monotonic()
        cli=subprocess.run(["tesseract",item["path"],"stdout",
                           "-l","kor+eng","--psm","7"],capture_output=True,text=True)
        tesseract_ms=round((time.monotonic()-t0)*1000)
        if cli.returncode: raise RuntimeError("Tesseract CLI failed: "+cli.stderr[-400:])
        for engine,text_value,ms in (("paddle",paddle_text,paddle_ms),
                                      ("tesseract",cli.stdout.strip(),tesseract_ms)):
            item[engine]=dict(text=text_value,exact=text_value.strip()==item["expected"],
                              inference_ms=ms)
        del item["path"]  # Never publish image bytes or local paths
    cache_roots=[Path.home()/".paddlex"/"official_models"/MODEL,
                 Path.home()/".paddlex"/"models"/MODEL]
    params=[p for root in cache_roots if root.exists() for p in root.rglob("*.pdiparams")]
    model_file=next(iter(params),None)
    report={
       "model":MODEL,
       "model_source":"PaddleOCR official TextRecognition automatic download",
       "model_sha256":sha(model_file) if model_file else None,
       "model_file_bytes":model_file.stat().st_size if model_file else None,
       "initial_model_load_ms":load_ms,
       "paddle_peak_process_rss_kib":resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
       "oracle_only":True,"detected_crop":"NOT_EVALUABLE",
       "browser_wasm":"NOT_EVALUABLE","onnx_conversion":"NOT_EVALUABLE",
       "rows":prepared,
       "metrics":{engine:{family:{cat:metric(prepared,engine,family,cat)
                  for cat in ("person","date","start","end")}
                  for family in SAMPLES} for engine in ("paddle","tesseract")}
    }
    print("CBH_OFFICIAL_PADDLE_ORACLE_REPORT="+json.dumps(report,ensure_ascii=False),flush=True)
    if any(not item["paddle"]["text"] for item in prepared):
        print("PADDLE_INCOMPLETE_NO_DEPLOY",flush=True)
    print("OCR_QUALITY_GATE_NOT_ACCEPTED: ORACLE_ONLY_NO_BROWSER_OR_MATRIX",flush=True)
