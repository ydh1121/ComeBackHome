"""One owner-authorized, synthetic-only Workers Free evaluation; no deployment.

Reuses the immutable v2 corpus/scorer. Original employee images and raw model
responses never enter logs/artifacts. Credentials exist only in the Actions
step environment; no dependencies are installed while they are present.
"""
import argparse
import base64
from datetime import datetime, timezone
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
from time import perf_counter
import urllib.error
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
CORPUS = ROOT / 'test/fixtures/import/free-ocr-evaluation-v2.zip'
CORPUS_SHA = '6ef21653700982396adf75d32e0fd892c939fcfc3453a4d0ca389bb2ba08965a'
SCORER_SHA = 'c673e7337cb65896057c543e07a599ed55050f221f74bcb1d6ded9fc94485004'
MODEL = '@cf/meta/llama-3.2-11b-vision-instruct'
# Owner screenshots dated 2026-10-13 prove Workers Free for this account.
# The owner reports negligible usage; exact account Neurons remain unmeasured.
PLAN_ACCOUNT_HASH = 'd325a0ebefd8e3dd7787698c1e4eed887ce6893214ef7b34ac442518b4f85f8d'
AUTHORIZED_DATE = '2026-10-13'
MAX_TOKENS = 6144
BUDGET_NEURONS = 8000
# The entire 128k context priced as input plus capped output is a conservative
# reservation when the API omits usage. This is NOT measured consumption.
WORST_CALL_NEURONS = 128000 * 4410 / 1e6 + MAX_TOKENS * 61493 / 1e6


def sha(data):
    return hashlib.sha256(data).hexdigest()


def load_corpus():
    data = CORPUS.read_bytes()
    if sha(data) != CORPUS_SHA:
        raise ValueError('CORPUS_HASH_MISMATCH')
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        prefix = 'cbh_free_ocr_eval/'
        manifest = json.loads(z.read(prefix + 'manifest.json'))
        truth = json.loads(z.read(prefix + 'ground_truth.json'))
        prompt = z.read(prefix + 'OCR_PROMPT.txt').decode('utf-8')
        scorer = z.read(prefix + 'evaluate.py')
        if sha(scorer) != SCORER_SHA or len(truth) != 336 or len(manifest['images']) != 12:
            raise ValueError('SCORER_OR_FIXTURE_SET_MISMATCH')
        images = []
        for entry in manifest['images']:
            image = z.read(prefix + entry['path'])
            if sha(image) != entry['sha256'] or len(image) != entry['bytes']:
                raise ValueError('IMAGE_HASH_MISMATCH')
            images.append((entry, image))
    return images, truth, prompt, scorer


def gate():
    if os.environ.get('CBH_FREE_EVAL_APPROVED_DATE') != AUTHORIZED_DATE:
        raise ValueError('OWNER_APPROVAL_DATE_REQUIRED')
    if datetime.now(timezone.utc).date().isoformat() != AUTHORIZED_DATE:
        raise ValueError('PLAN_EVIDENCE_EXPIRED_RECHECK_REQUIRED')
    if os.environ.get('GITHUB_REPOSITORY') != 'ydh1121/ComeBackHome':
        raise ValueError('REPOSITORY_NOT_AUTHORIZED')
    if os.environ.get('GITHUB_REF') != 'refs/heads/feat/nonimage-weekly-xlsx-import':
        raise ValueError('BRANCH_NOT_AUTHORIZED')
    if os.environ.get('GITHUB_RUN_ATTEMPT') != '1':
        raise ValueError('AUTOMATIC_RETRY_FORBIDDEN')
    account = os.environ.get('CBH_ACCOUNT_ID', '')
    token = os.environ.get('CBH_AI_TOKEN', '')
    if sha(account.encode()) != PLAN_ACCOUNT_HASH or not token:
        raise ValueError('OWNER_ACCOUNT_OR_AI_SECRET_MISSING')
    return account, token


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def request_once(account, token, payload):
    # Fixed official origin, model and account. No Gateway, paid fallback,
    # billing write, D1 access, worker creation, retry or redirect.
    url = 'https://api.cloudflare.com/client/v4/accounts/' + account + '/ai/run/' + MODEL
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), method='POST',
        headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
    started = perf_counter()
    report = {'http': None, 'latency_ms': None, 'usage': None,
              'neurons_measured': None, 'neurons_pricing_estimate': None}
    try:
        with urllib.request.build_opener(NoRedirect()).open(req, timeout=120) as resp:
            report['http'] = resp.status
            raw = resp.read(2 * 1024 * 1024 + 1)
        if len(raw) > 2 * 1024 * 1024:
            report['error'] = 'RESPONSE_TOO_LARGE'
            return report, None
        report['response_sha256'] = sha(raw)
        result = json.loads(raw)
        report['api_success'] = result.get('success') is True and not result.get('errors')
        report['error_codes'] = [e['code'] for e in result.get('errors', [])
                                 if isinstance(e, dict) and isinstance(e.get('code'), int)]
        value = result.get('result')
        usage = value.get('usage') if isinstance(value, dict) else None
        if isinstance(usage, dict):
            report['usage'] = {k: usage[k] for k in ('prompt_tokens', 'completion_tokens', 'total_tokens')
                               if type(usage.get(k)) is int and usage[k] >= 0}
            u = report['usage']
            if 'prompt_tokens' in u and 'completion_tokens' in u:
                report['neurons_pricing_estimate'] = round(
                    (u['prompt_tokens'] * 4410 + u['completion_tokens'] * 61493) / 1e6, 6)
        return report, value
    except urllib.error.HTTPError as e:
        report['http'] = e.code
        report['error'] = 'HTTP_FAILURE_STOP_NO_RETRY'
        # Error bodies can contain account information. Never log them.
        return report, None
    except Exception:
        report['error'] = 'NETWORK_OR_RESPONSE_FAILURE_CONSUMPTION_UNKNOWN_STOP_NO_RETRY'
        return report, None
    finally:
        report['latency_ms'] = round((perf_counter() - started) * 1000)


def parse_cells(value):
    text = value.get('response') if isinstance(value, dict) else None
    if not isinstance(text, str):
        return [], 'NO_TEXT_RESPONSE'
    text = text.strip()
    if text.startswith('```') and text.endswith('```'):
        text = text[text.find('\n') + 1:-3].strip()
    try:
        data = json.loads(text)
    except ValueError:
        return [], 'INVALID_OR_TRUNCATED_JSON'
    cells = data.get('cells') if isinstance(data, dict) else None
    if not isinstance(cells, list) or len(cells) > 100 or any(not isinstance(x, dict) for x in cells):
        return [], 'INVALID_CELLS_SCHEMA'
    # No ground-truth repair, guessed dates/names, forced source IDs, approval
    # defaults or partial-JSON salvage: independent scorer sees actual output.
    return cells, None


def score_with_original(scorer_source, truth, cells):
    with tempfile.TemporaryDirectory(prefix='cbh-independent-scorer-') as tmp:
        path = Path(tmp) / 'evaluate.py'
        path.write_bytes(scorer_source)
        spec = importlib.util.spec_from_file_location('cbh_v2_scorer', path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module.score(truth, cells)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--run', action='store_true', help='Execute only the dated owner-authorized evaluation')
    args = ap.parse_args()
    images, truth, prompt, scorer = load_corpus()
    if not args.run:
        print(json.dumps({'check': 'PASS', 'network_calls': 0, 'images': len(images),
                          'truth_cells': len(truth), 'corpus_sha256': CORPUS_SHA, 'scorer_sha256': SCORER_SHA}))
        return
    account, token = gate()
    report = {'model': MODEL, 'corpus_sha256': CORPUS_SHA, 'scorer_sha256': SCORER_SHA,
        'plan': 'WORKERS_FREE_OWNER_SCREENSHOT_VERIFIED', 'plan_evidence_date': AUTHORIZED_DATE,
        'prior_usage': 'OWNER_REPORTS_NEGLIGIBLE_EXACT_NEURONS_NOT_MEASURED',
        'free_only_enforcement': 'WORKERS_FREE_PROVIDER_HARD_CAP_NO_GATEWAY_NO_UPGRADE',
        'local_budget_neurons': BUDGET_NEURONS, 'account_neurons_remaining': None,
        'production_writes': 0, 'private_images': 0, 'paid_fallback': False,
        'inference_requests_attempted': 0, 'images': [], 'acceptance': 'NOT_ACCEPTED_BY_THIS_BENCHMARK'}
    # Existing owner Meta License/AUP consent is approved. This is its official
    # documented API operation, not a new request for owner approval.
    consent, _ = request_once(account, token, {'prompt': 'agree'})
    report['licence_api'] = consent
    reserved = consent.get('neurons_pricing_estimate')
    reserved = reserved if reserved is not None else WORST_CALL_NEURONS
    predictions = []
    if not consent.get('api_success'):
        report['blocker'] = 'OFFICIAL_LICENCE_API_FAILED_OR_UNKNOWN'
    else:
        for entry, image in images:
            if reserved + WORST_CALL_NEURONS > BUDGET_NEURONS:
                report['blocker'] = 'CONSERVATIVE_RUN_BUDGET_STOP'
                break
            if datetime.now(timezone.utc).date().isoformat() != AUTHORIZED_DATE:
                report['blocker'] = 'PLAN_EVIDENCE_EXPIRED'
                break
            report['inference_requests_attempted'] += 1
            item, value = request_once(account, token, {
                'prompt': prompt + '\nsource_image_id = ' + entry['id'],
                'image': 'data:image/png;base64,' + base64.b64encode(image).decode('ascii'),
                'max_tokens': MAX_TOKENS, 'temperature': 0,
            })
            item.update({'image_id': entry['id'], 'image_sha256': entry['sha256'], 'input': 'ORIGINAL_FULL_SYNTHETIC_PNG'})
            cells, parse_error = parse_cells(value)
            item['parse_error'] = parse_error
            item['predicted_cells'] = len(cells)
            item['score'] = score_with_original(scorer, [x for x in truth if x['source_image_id'] == entry['id']], cells)
            predictions.extend(cells)
            report['images'].append(item)
            charged = item.get('neurons_pricing_estimate')
            reserved += charged if charged is not None else WORST_CALL_NEURONS
            if not item.get('api_success'):
                report['blocker'] = 'MODEL_REQUEST_FAILED_OR_UNKNOWN_STOP_NO_RETRY'
                break
    report['budget_reserved_neurons'] = round(reserved, 6)
    report['scored_images'] = len(report['images'])
    report['aggregate'] = score_with_original(scorer, truth, predictions)
    report['real_provider_requests_executed'] = bool(report['images'])
    # The scorer's bool(predictions) is not sufficient to establish provenance;
    # preserve its result and also report actual attempted HTTP requests above.
    print('CBH_FREE_OCR_V2=' + json.dumps(report, ensure_ascii=False, separators=(',', ':')))
    if report.get('blocker'):
        raise SystemExit(2)


if __name__ == '__main__':
    main()
