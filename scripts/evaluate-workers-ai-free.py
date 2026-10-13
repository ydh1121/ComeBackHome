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
import re
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


def failure_diagnostics(raw, headers):
    """Return only bounded, non-secret protocol diagnostics, never response text."""
    mime = (headers.get('Content-Type', '') if headers else '').split(';')[0].lower()
    ray = headers.get('CF-Ray', '') if headers else ''
    info = {'response_format': 'NON_JSON', 'response_bytes': len(raw),
            'response_sha256': sha(raw), 'error_codes': [],
            'content_type': mime if mime in ('application/json', 'text/plain', 'text/html') else 'OTHER',
            'cloudflare_ray': ray if re.fullmatch(r'[a-fA-F0-9]{16,32}-[A-Z]{3}', ray) else None}
    try:
        failure = json.loads(raw)
        info['response_format'] = 'JSON'
        if isinstance(failure, dict):
            info['error_codes'] = [x['code'] for x in failure.get('errors', [])
                if isinstance(x, dict) and type(x.get('code')) is int]
    except (ValueError, TypeError):
        # Cloudflare edge errors may be text/HTML instead of API JSON. Extract
        # only a numeric error marker, not identifiers, URLs or arbitrary text.
        text = raw.decode('utf-8', errors='replace')
        codes = re.findall(r'\berror\s*(?:code\s*)?[:\s]+(\d{3,5})\b', text, re.I)
        info['error_codes'] = sorted(set(int(code) for code in codes))[:5]
    return info


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
        report.update(failure_diagnostics(e.read(65536), e.headers))
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


def parse_compact_cells(value):
    """Expand repeated field names only; never repair a model-produced value."""
    response = value.get('response') if isinstance(value, dict) else None
    if not isinstance(response, str):
        return [], 'NO_TEXT_RESPONSE'
    text = response.strip()
    if text.startswith('```') and text.endswith('```'):
        text = text[text.find('\n') + 1:-3].strip()
    try:
        data = json.loads(text)
    except ValueError:
        return [], 'INVALID_OR_TRUNCATED_JSON'
    if not isinstance(data, dict) or not isinstance(data.get('source_image_id'), str):
        return [], 'INVALID_COMPACT_SOURCE'
    rows = data.get('rows')
    if not isinstance(rows, list) or len(rows) > 100:
        return [], 'INVALID_COMPACT_ROWS'
    cells = []
    keys = ('employee_row', 'column_group', 'date', 'weekday', 'employee_name',
            'status', 'clock_in', 'clock_out', 'break_minutes', 'review_required')
    for row in rows:
        if not isinstance(row, list) or len(row) != 14:
            return [], 'INVALID_COMPACT_ROW_LENGTH'
        if any(isinstance(x, (dict, list)) for x in row[:10]):
            return [], 'INVALID_COMPACT_SCALAR'
        cell = dict(zip(keys, row[:10]))
        cell.update(source_image_id=data['source_image_id'],
            original_text={'clock_in': row[10], 'clock_out': row[11], 'break': row[12]},
            evidence_bbox=row[13])
        cells.append(cell)
    return cells, None


def compact_instructions(prompt):
    # Preserve recognition/review rules from v2; replace only the repeated-key
    # serialization line. The evaluator and truth are never provided to model.
    lines = [line for line in prompt.splitlines() if not line.startswith('각 직원/날짜 셀마다 ')]
    lines += [
        '응답은 설명이나 마크다운 없이 압축 JSON {"source_image_id":"이미지 ID","rows":[[...]]} 한 개만 반환하세요.',
        '각 직원/날짜 셀을 14개 원소의 배열로 출력하세요. 배열의 순서는 다음과 같습니다:',
        '[employee_row(0 기반), column_group(0..6), date(YYYY-MM-DD), weekday(월요일0), employee_name, '
        'status(SHIFT|OFF_CANDIDATE|UNREADABLE|BLANK), clock_in(HH:mm 또는 null), clock_out(HH:mm 또는 null), '
        'break_minutes(숫자 또는 null), review_required(true), 원문출근문자열, 원문퇴근문자열, 원문휴게문자열, evidence_bbox(없으면 null)]',
        '필드 이름을 각 셀에 반복하지 마세요. 빈 값도 해당 위치에 null로 남기세요. 직원 순서와 날짜 연결을 이미지 근거대로 유지하세요.',
    ]
    return '\n'.join(lines)


def score_with_original(scorer_source, truth, cells):
    with tempfile.TemporaryDirectory(prefix='cbh-independent-scorer-') as tmp:
        path = Path(tmp) / 'evaluate.py'
        path.write_bytes(scorer_source)
        spec = importlib.util.spec_from_file_location('cbh_v2_scorer', path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module.score(truth, cells)


def run_day0_pilot(truth, prompt, scorer, compact=False):
    """One materially smaller diagnostic; never repeat the timed-out full image."""
    account, token = gate()
    previous = json.loads((ROOT / 'runtime-evidence/workers-ai-read-edit-20261013.json').read_text())
    if (previous['run_id'] != 38356883322 or previous['model'] != MODEL
            or previous['licence_api']['http'] != 200 or not previous['licence_api']['api_success']):
        raise ValueError('VERIFIED_OFFICIAL_LICENCE_RESPONSE_REQUIRED')
    prior_reserved = previous['budget_reserved_neurons']
    if compact:
        prior_pilot = json.loads((ROOT / 'runtime-evidence/workers-ai-day0-20261013.json').read_text())
        if prior_pilot['run_id'] != 38357728022 or prior_pilot['api']['http'] != 200:
            raise ValueError('COMPLETED_PILOT_EVIDENCE_REQUIRED')
        prior_reserved = prior_pilot['budget_reserved_neurons']
        prompt = compact_instructions(prompt)
    max_tokens = 1024
    reserve = 128000 * 4410 / 1e6 + max_tokens * 61493 / 1e6
    if prior_reserved + reserve > BUDGET_NEURONS:
        raise ValueError('PRIOR_UNKNOWN_REQUEST_MUST_REMAIN_IN_BUDGET')
    image = (ROOT / 'test/fixtures/import/free-ocr-v2-day0-pilot.png').read_bytes()
    crop_sha = 'd125815fb3eb26f544116105e16970ad0ab7f7af7ffd621c2e3576f35ce40c4b'
    if sha(image) != crop_sha:
        raise ValueError('PILOT_IMAGE_HASH_MISMATCH')
    image_id = 'A_high_resolution'
    instructions = prompt + '\nsource_image_id = ' + image_id
    instructions += ('\n이 이미지는 원본 근무표의 직원명 열과 1번째 날짜 그룹만 나란히 붙인 테스트입니다. '
                     '원본 column_group=0을 유지하고 직원-날짜 관계는 이미지에 실제 있는 근거로만 추출하세요.')
    result, value = request_once(account, token, {'prompt': instructions,
        'image': 'data:image/png;base64,' + base64.b64encode(image).decode('ascii'),
        'max_tokens': max_tokens, 'temperature': 0})
    cells, parse_error = (parse_compact_cells if compact else parse_cells)(value)
    subset = [x for x in truth if x['source_image_id'] == image_id and x['column_group'] == 0]
    estimate = result.get('neurons_pricing_estimate')
    report = {'model': MODEL, 'scope': 'KNOWN_TEMPLATE_DAY_CROP_DIAGNOSTIC_NOT_FULL_IMAGE_ACCURACY',
        'output_representation': 'COMPACT_14_FIELDS_LOSSLESS_MAP' if compact else 'VERBOSE_CELLS',
        'original_corpus_sha256': CORPUS_SHA, 'scorer_sha256': SCORER_SHA,
        'source_image_id': image_id, 'source_image_sha256': previous['image_source_sha256'],
        'crop_sha256': crop_sha, 'source_regions': [[18, 0, 134, 311], [134, 0, 437, 311]],
        'image_requests_attempted': 1, 'licence_requests_attempted': 0,
        'prior_verified_licence_run': previous['run_id'], 'max_output_tokens': max_tokens,
        'prior_budget_reserved_neurons': prior_reserved,
        'budget_reserved_neurons': round(prior_reserved + (estimate if estimate is not None else reserve), 6),
        'actual_neurons': None, 'api': result, 'parse_error': parse_error,
        'completed_model_response': result.get('api_success') is True,
        'score': score_with_original(scorer, subset, cells) if result.get('api_success') else None,
        'production_writes': 0, 'private_images': 0, 'paid_fallback': False,
        'acceptance': 'DIAGNOSTIC_ONLY_NOT_PRODUCT_ACCEPTANCE'}
    print('CBH_FREE_OCR_DAY0=' + json.dumps(report, ensure_ascii=False, separators=(',', ':')), flush=True)
    if not result.get('api_success') or parse_error:
        raise SystemExit(2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--run', action='store_true', help='Execute only the dated owner-authorized evaluation')
    ap.add_argument('--pilot-day0', action='store_true', help='One bounded existing-v2 day-crop diagnostic')
    ap.add_argument('--pilot-compact', action='store_true', help='One compact serialization diagnostic after completed pilot')
    args = ap.parse_args()
    if sum((args.run, args.pilot_day0, args.pilot_compact)) > 1:
        ap.error('choose exactly one execution scope')
    images, truth, prompt, scorer = load_corpus()
    if args.pilot_day0 or args.pilot_compact:
        return run_day0_pilot(truth, prompt, scorer, compact=args.pilot_compact)
    if not args.run:
        print(json.dumps({'check': 'PASS', 'network_calls': 0, 'images': len(images),
                          'truth_cells': len(truth), 'corpus_sha256': CORPUS_SHA, 'scorer_sha256': SCORER_SHA}))
        return
    account, token = gate()
    report = {'model': MODEL, 'corpus_sha256': CORPUS_SHA, 'scorer_sha256': SCORER_SHA,
        'plan': 'WORKERS_FREE_OWNER_SCREENSHOT_VERIFIED', 'plan_evidence_date': AUTHORIZED_DATE,
        'owner_scope_evidence': '2026-10-13T15:25+09:00_SCREENSHOT_WORKERS_AI_READ_AND_EDIT',
        'http_client': 'PYTHON_URLLIB_UNCHANGED_NO_HEADER_OR_ROUTE_SUBSTITUTION',
        'prior_usage': 'OWNER_REPORTS_NEGLIGIBLE_EXACT_NEURONS_NOT_MEASURED',
        'free_only_enforcement': 'WORKERS_FREE_PROVIDER_HARD_CAP_NO_GATEWAY_NO_UPGRADE',
        'local_budget_neurons': BUDGET_NEURONS, 'account_neurons_remaining': None,
        'production_writes': 0, 'private_images': 0, 'paid_fallback': False,
        'licence_requests_attempted': 1, 'inference_requests_attempted': 0,
        'images': [], 'acceptance': 'NOT_ACCEPTED_BY_THIS_BENCHMARK'}
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
    # No model call means accuracy is unmeasured, not 0%. An attempted image
    # with malformed output still receives the unchanged scorer's missing-cell
    # penalties; only a wholly unexecuted benchmark omits accuracy.
    report['aggregate'] = score_with_original(scorer, truth, predictions) if report['images'] else None
    report['real_provider_requests_executed'] = bool(report['images'])
    # The scorer's bool(predictions) is not sufficient to establish provenance;
    # preserve its result and also report actual attempted HTTP requests above.
    print('CBH_FREE_OCR_V2=' + json.dumps(report, ensure_ascii=False, separators=(',', ':')))
    if report.get('blocker'):
        raise SystemExit(2)


if __name__ == '__main__':
    main()
