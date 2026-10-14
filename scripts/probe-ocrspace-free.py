"""Third-provider readiness and one synthetic response-contract probe.

Reuses the immutable v2 corpus. This is not a new scorer or OCR acceptance.
No images, OCR text, provider error messages or credentials leave process memory.
"""
import argparse
import base64
from datetime import datetime, timezone
import importlib.util
import json
import os
from pathlib import Path
from time import perf_counter
import urllib.error
import urllib.parse
import urllib.request

spec = importlib.util.spec_from_file_location('cbh_free_ocr', Path(__file__).with_name('evaluate-workers-ai-free.py'))
shared = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shared)
ENDPOINT = 'https://api.ocr.space/parse/image'
MAX_IMAGE_BYTES = 1_000_000
MAX_RESPONSE_BYTES = 2 * 1024 * 1024


def readiness():
    key = os.environ.get('OCRSPACE_API_KEY', '').strip()
    checks = {
        'owner_key_present': bool(key) and key.lower() != 'helloworld',
        'owner_free_key_confirmed': os.environ.get('CBH_OCRSPACE_FREE_CONFIRMED') == 'true',
        'same_day_free_key_proof': os.environ.get('CBH_OCRSPACE_FREE_PROOF_DATE') == datetime.now(timezone.utc).date().isoformat(),
        'repository': os.environ.get('GITHUB_REPOSITORY') == 'ydh1121/ComeBackHome',
        'branch': os.environ.get('GITHUB_REF') == 'refs/heads/feat/nonimage-weekly-xlsx-import',
        'first_attempt': os.environ.get('GITHUB_RUN_ATTEMPT') == '1',
    }
    return {'checks': checks, 'ready': all(checks.values()), 'network_calls': 0,
            'acceptance': 'PREFLIGHT_ONLY_NOT_PROVIDER_ACCEPTANCE'}


def build_payload(image):
    if not image.startswith(b'\x89PNG\r\n\x1a\n') or len(image) > MAX_IMAGE_BYTES:
        raise ValueError('ORIGINAL_PNG_WITHIN_FREE_SIZE_LIMIT_REQUIRED')
    # Fixed HTTPS Free endpoint and owner header key. No URL upload/demo key/PRO.
    return urllib.parse.urlencode({
        'base64Image': 'data:image/png;base64,' + base64.b64encode(image).decode('ascii'),
        'OCREngine': '3', 'language': 'auto', 'filetype': 'PNG',
        'isTable': 'true', 'isOverlayRequired': 'true',
        'isCreateSearchablePdf': 'false',
    }).encode('ascii')


def response_metadata(data):
    """Report typed status and shape counts only, never text or error messages."""
    report = {'api_success': False}
    if not isinstance(data, dict):
        return report
    code = data.get('OCRExitCode')
    if type(code) is int:
        report['ocr_exit_code'] = code
    errored = data.get('IsErroredOnProcessing')
    if type(errored) is bool:
        report['processing_error'] = errored
    processing_ms = data.get('ProcessingTimeInMilliseconds')
    if isinstance(processing_ms, str) and processing_ms.isdigit():
        processing_ms = int(processing_ms)
    if type(processing_ms) is int and 0 <= processing_ms <= 600_000:
        report['provider_processing_ms'] = processing_ms
    pages = data.get('ParsedResults')
    if not isinstance(pages, list):
        return report
    report['pages'] = len(pages)
    if len(pages) != 1 or not isinstance(pages[0], dict):
        return report
    page = pages[0]
    page_code = page.get('FileParseExitCode')
    if page_code in ('1', '0', '-10', '-20', '-30', '-99'):
        page_code = int(page_code)
    if type(page_code) is int:
        report['page_exit_code'] = page_code
    text = page.get('ParsedText')
    if isinstance(text, str):
        lines = text.splitlines()
        report['text_shape'] = {
            'characters': len(text), 'lines': len(lines),
            'pipe_table_lines': sum(line.count('|') >= 3 for line in lines),
            'html_table_tags': text.lower().count('<table'),
        }
    overlay = page.get('TextOverlay')
    if isinstance(overlay, dict) and isinstance(overlay.get('Lines'), list):
        words = [word for line in overlay['Lines'] if isinstance(line, dict)
                 and isinstance(line.get('Words'), list) for word in line['Words']]
        valid = sum(isinstance(word, dict) and isinstance(word.get('WordText'), str)
                    and all(type(word.get(field)) in (int, float) and 0 <= word[field] < 100_000
                            for field in ('Left', 'Top', 'Width', 'Height')) for word in words)
        report['overlay_shape'] = {'lines': len(overlay['Lines']), 'words': len(words),
                                   'words_with_valid_bounds': valid}
    report['api_success'] = (type(code) is int and code == 1 and errored is False
                             and type(page_code) is int and page_code == 1
                             and isinstance(text, str) and bool(text.strip()))
    return report


def request_once(key, image):
    request = urllib.request.Request(ENDPOINT, data=build_payload(image), method='POST',
        headers={'apikey': key, 'Content-Type': 'application/x-www-form-urlencoded'})
    report = {'http': None, 'api_success': False, 'latency_ms': None,
              'billed_conversions': None, 'remaining_conversions': None}
    started = perf_counter()
    try:
        opener = urllib.request.build_opener(shared.NoRedirect())
        with opener.open(request, timeout=120) as response:
            raw = response.read(MAX_RESPONSE_BYTES + 1)
            report['http'] = response.status
        if len(raw) > MAX_RESPONSE_BYTES:
            raise ValueError('RESPONSE_TOO_LARGE')
        report['response_sha256'] = shared.sha(raw)
        report.update(response_metadata(json.loads(raw)))
        report['api_success'] = report['http'] == 200 and report['api_success']
    except urllib.error.HTTPError as error:
        report.update(http=error.code, error='HTTP_FAILURE_STOP_NO_RETRY',
                      response_sha256=shared.sha(error.read(65536)))
    except Exception:
        report['error'] = 'NETWORK_OR_RESPONSE_FAILURE_CONSUMPTION_UNKNOWN_STOP_NO_RETRY'
    finally:
        report['latency_ms'] = round((perf_counter() - started) * 1000)
    return report


def probe():
    images, _, _, _ = shared.load_corpus()
    entry, image = images[0]
    ready = readiness()
    if not ready['ready']:
        print('CBH_OCRSPACE_PREFLIGHT=' + json.dumps(ready), flush=True)
        raise SystemExit(2)
    result = request_once(os.environ['OCRSPACE_API_KEY'].strip(), image)
    result.update(provider='OCRSPACE', engine=3, image_id=entry['id'],
        image_sha256=entry['sha256'], corpus_sha256=shared.CORPUS_SHA,
        scorer_sha256=shared.SCORER_SHA, maximum_requests=1,
        reserved_conversions=1, private_images=0, production_writes=0,
        paid_fallback=False, score=None, aggregate=None,
        acceptance='RESPONSE_CONTRACT_PROBE_ONLY_NOT_OCR_ACCEPTANCE')
    print('CBH_OCRSPACE_PROBE=' + json.dumps(result, separators=(',', ':')), flush=True)
    if not result['api_success']:
        raise SystemExit(2)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--probe', action='store_true')
    args = parser.parse_args()
    if args.probe:
        probe()
    else:
        shared.load_corpus()
        print('CBH_OCRSPACE_PREFLIGHT=' + json.dumps(readiness()))
