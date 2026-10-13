"""Prepared second-provider evaluation. No API calls without free-project proof.

Only the existing hash-verified synthetic corpus is accepted. Reuses the original
independent scorer, not its self-test. Never prints keys, images or OCR text.
"""
import argparse
import base64
from datetime import datetime, timezone
import importlib.util
import json
import os
from pathlib import Path
from time import monotonic, perf_counter, sleep
import urllib.error
import urllib.request

spec = importlib.util.spec_from_file_location('cbh_free_ocr', Path(__file__).with_name('evaluate-workers-ai-free.py'))
shared = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shared)
MODEL = 'gemini-3.8-flash'
ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/' + MODEL + ':generateContent'
MAX_OUTPUT = 8192


def readiness():
    today = datetime.now(timezone.utc).date().isoformat()
    checks = {
        'key_present': bool(os.environ.get('GEMINI_API_KEY')),
        'owner_free_project_confirmed': os.environ.get('CBH_GEMINI_FREE_PROJECT_CONFIRMED') == 'true',
        'same_day_free_project_proof': os.environ.get('CBH_GEMINI_FREE_PROJECT_PROOF_DATE') == today,
        'repository': os.environ.get('GITHUB_REPOSITORY') == 'ydh1121/ComeBackHome',
        'branch': os.environ.get('GITHUB_REF') == 'refs/heads/feat/nonimage-weekly-xlsx-import',
        'first_attempt': os.environ.get('GITHUB_RUN_ATTEMPT') == '1',
    }
    return {'checks': checks, 'ready': all(checks.values()), 'network_calls': 0,
            'acceptance': 'PREFLIGHT_ONLY_NOT_PROVIDER_ACCEPTANCE'}


def build_payload(image_id, image, prompt):
    return {'contents': [{'role': 'user', 'parts': [
        {'text': prompt + '\nsource_image_id = ' + image_id},
        {'inlineData': {'mimeType': 'image/png', 'data': base64.b64encode(image).decode('ascii')}}]}],
        'generationConfig': {'candidateCount': 1, 'maxOutputTokens': MAX_OUTPUT,
            'responseMimeType': 'application/json', 'responseJsonSchema': shared.roster_json_schema(),
            'thinkingConfig': {'thinkingLevel': 'LOW', 'includeThoughts': False}},
        'store': False}


def extract_text(data):
    candidates = data.get('candidates', []) if isinstance(data, dict) else []
    if len(candidates) != 1 or not isinstance(candidates[0], dict):
        return None, 'NO_UNIQUE_CANDIDATE'
    candidate = candidates[0]
    reason = candidate.get('finishReason')
    if reason != 'STOP':
        return None, reason if reason in ('MAX_TOKENS', 'SAFETY', 'RECITATION') else 'NONSTOP_RESPONSE'
    parts = candidate.get('content', {}).get('parts', [])
    texts = [part['text'] for part in parts if isinstance(part, dict)
             and not part.get('thought') and isinstance(part.get('text'), str)]
    return ''.join(texts) if texts else None, 'STOP'


def request_once(key, payload):
    request = urllib.request.Request(ENDPOINT, data=json.dumps(payload).encode(), method='POST',
        headers={'x-goog-api-key': key, 'Content-Type': 'application/json'})
    started = perf_counter()
    report = {'http': None, 'latency_ms': None, 'usage': None, 'api_success': False}
    try:
        with urllib.request.build_opener(shared.NoRedirect()).open(request, timeout=120) as response:
            report['http'] = response.status
            raw = response.read(2 * 1024 * 1024 + 1)
        report['response_sha256'] = shared.sha(raw)
        if len(raw) > 2 * 1024 * 1024:
            raise ValueError('RESPONSE_TOO_LARGE')
        data = json.loads(raw)
        usage = data.get('usageMetadata', {})
        report['usage'] = {k: usage[k] for k in ('promptTokenCount', 'candidatesTokenCount',
            'thoughtsTokenCount', 'totalTokenCount') if type(usage.get(k)) is int and usage[k] >= 0}
        response_text, reason = extract_text(data)
        report.update(finish_reason=reason, api_success=report['http'] == 200 and reason == 'STOP'
                      and response_text is not None and not data.get('error'))
        return report, {'response': response_text}
    except urllib.error.HTTPError as error:
        report.update(http=error.code, error='HTTP_FAILURE_STOP_NO_RETRY')
        raw = error.read(65536)
        report['response_sha256'] = shared.sha(raw)
        try:
            code = json.loads(raw).get('error', {}).get('code')
            report['error_codes'] = [code] if type(code) is int else []
        except (ValueError, AttributeError):
            report['error_codes'] = []
        return report, None
    except Exception:
        report['error'] = 'NETWORK_OR_RESPONSE_FAILURE_CONSUMPTION_UNKNOWN_STOP_NO_RETRY'
        return report, None
    finally:
        report['latency_ms'] = round((perf_counter() - started) * 1000)


def run():
    ready = readiness()
    if not ready['ready']:
        print('CBH_GEMINI_PREFLIGHT=' + json.dumps(ready), flush=True)
        raise SystemExit(2)
    images, truth, prompt, scorer = shared.load_corpus()
    key = os.environ['GEMINI_API_KEY']
    report = {'provider': 'GOOGLE_GEMINI_DEVELOPER_API', 'model': MODEL,
        'corpus_sha256': shared.CORPUS_SHA, 'scorer_sha256': shared.SCORER_SHA,
        'max_output_tokens': MAX_OUTPUT, 'maximum_requests': 12, 'images': [],
        'free_project': 'OWNER_CONFIRMED_SAME_DAY_NOT_PROGRAMMATIC_BILLING_VERIFICATION',
        'production_writes': 0, 'private_images': 0, 'paid_fallback': False,
        'acceptance': 'NOT_ACCEPTED_BY_THIS_BENCHMARK'}
    predictions = []
    attempted_truth = []
    previous_start = None
    for entry, image in images:
        if not readiness()['ready']:
            report['blocker'] = 'FREE_PROJECT_PROOF_EXPIRED'
            break
        if previous_start is not None:
            sleep(max(0, 30 - (monotonic() - previous_start)))
        # Pacing may cross UTC midnight; recheck immediately before the request.
        if not readiness()['ready']:
            report['blocker'] = 'FREE_PROJECT_PROOF_EXPIRED'
            break
        previous_start = monotonic()
        item, value = request_once(key, build_payload(entry['id'], image, prompt))
        cells, error = shared.parse_complete_cells(value)
        subset = [cell for cell in truth if cell['source_image_id'] == entry['id']]
        item.update(image_id=entry['id'], image_sha256=entry['sha256'],
            parse_error=error, predicted_cells=len(cells),
            score=shared.score_with_original(scorer, subset, cells) if item['api_success'] else None)
        report['images'].append(item)
        predictions.extend(cells)
        attempted_truth.extend(subset)
        print('CBH_GEMINI_IMAGE=' + json.dumps(item, separators=(',', ':')), flush=True)
        if not item['api_success'] or error:
            report['blocker'] = 'REQUEST_OR_OUTPUT_FAILURE_STOP_NO_RETRY'
            break
    report['complete_v2'] = len(report['images']) == 12 and not report.get('blocker')
    report['aggregate'] = shared.score_with_original(scorer, truth, predictions) if report['complete_v2'] else None
    report['attempted_subset_score'] = shared.score_with_original(scorer, attempted_truth, predictions) if attempted_truth else None
    print('CBH_GEMINI_V2=' + json.dumps(report, separators=(',', ':')), flush=True)
    if report.get('blocker'):
        raise SystemExit(2)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--run', action='store_true')
    args = parser.parse_args()
    if args.run:
        run()
    else:
        shared.load_corpus()
        print('CBH_GEMINI_PREFLIGHT=' + json.dumps(readiness()))
