"""Offline boundary checks; no external inference or recognition-accuracy claim."""
from contextlib import redirect_stdout
from datetime import datetime, timezone
import importlib.util
import io
import json
import os
from pathlib import Path
import urllib.error
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('cbh_gemini', Path(__file__).with_name('evaluate-gemini-free.py'))
gemini = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gemini)
shared = gemini.shared


def stopped_run():
    output = io.StringIO()
    with redirect_stdout(output):
        try:
            gemini.run()
        except SystemExit as error:
            assert error.code == 2
        else:
            raise AssertionError('Expected fail-closed evaluation')
    return output.getvalue()


images, truth, prompt, _ = shared.load_corpus()
assert len(images) == 12 and len(truth) == 336
for invalid in (
    '```json\n{"cells":[]}',
    '```json\n{}\n```\n```json\n{}\n```',
    '{}\n```json\n{"cells":[]}\n```',
    '{"cells":[],"cells":[]}',
    '{"cells":NaN}',
):
    value, error = shared.complete_json({'response': invalid})
    assert error and value is None

# Framing must never repair incorrect model values from known truth.
wrong = [0, 0, '2099-01-01', 6, 'synthetic-wrong-name', 'SHIFT',
         '01:00', '02:00', 0, False, '1', '2', '0', None]
cells, error = shared.parse_complete_cells({'response': json.dumps({
    'source_image_id': 'wrong-id', 'rows': [wrong]})})
assert not error and cells[0]['date'] == '2099-01-01'
assert cells[0]['review_required'] is False and cells[0]['source_image_id'] == 'wrong-id'
schema = shared.roster_json_schema()
assert schema['properties']['cells']['items']['properties']['review_required'] == {'type': 'boolean'}

with patch.dict(os.environ, {}, clear=True), patch.object(gemini, 'request_once') as request:
    report = stopped_run()
    request.assert_not_called()
    assert '"network_calls": 0' in report

payload = gemini.build_payload(images[0][0]['id'], images[0][1], prompt)
assert payload['store'] is False and 'tools' not in payload and 'cachedContent' not in payload
assert payload['generationConfig']['maxOutputTokens'] == 8192
assert payload['contents'][0]['parts'][0]['text'].startswith(prompt + '\n')
text, reason = gemini.extract_text({'candidates': [{'finishReason': 'STOP', 'content': {'parts': [
    {'thought': True, 'text': 'private reasoning'}, {'text': '{"cells":[]}'}]}}]})
assert text == '{"cells":[]}' and reason == 'STOP'
assert gemini.extract_text({'candidates': [{'finishReason': 'MAX_TOKENS'}]}) == (None, 'MAX_TOKENS')

# Only numeric failure metadata may leave the request; quota errors never retry.
failure = urllib.error.HTTPError(gemini.ENDPOINT, 429, 'quota', {},
    io.BytesIO(b'{"error":{"code":429,"message":"sentinel-sensitive"}}'))
with patch.object(gemini.urllib.request, 'build_opener') as opener:
    opener.return_value.open.side_effect = failure
    report, value = gemini.request_once('test-key', payload)
    assert report['http'] == 429 and report['error_codes'] == [429] and value is None
    assert 'sentinel-sensitive' not in json.dumps(report) and 'test-key' not in json.dumps(report)
    request_arg = opener.return_value.open.call_args.args[0]
    assert 'test-key' not in request_arg.full_url
    assert request_arg.get_header('X-goog-api-key') == 'test-key'

ready_env = {'GEMINI_API_KEY': 'test-key', 'CBH_GEMINI_FREE_PROJECT_CONFIRMED': 'true',
    'CBH_GEMINI_FREE_PROJECT_PROOF_DATE': datetime.now(timezone.utc).date().isoformat(),
    'GITHUB_REPOSITORY': 'ydh1121/ComeBackHome',
    'GITHUB_REF': 'refs/heads/feat/nonimage-weekly-xlsx-import', 'GITHUB_RUN_ATTEMPT': '1'}
with patch.dict(os.environ, ready_env, clear=True), patch.object(gemini, 'request_once',
        return_value=({'http': 429, 'api_success': False}, None)) as request:
    output = stopped_run()
    request.assert_called_once()
    report = json.loads(output.split('CBH_GEMINI_V2=')[1])
    assert report['aggregate'] is None and report['complete_v2'] is False

# UTC proof expiry between pacing and request also prevents network access.
with patch.object(gemini, 'readiness', side_effect=[{'ready': True}, {'ready': True}, {'ready': False}]), \
        patch.dict(os.environ, ready_env, clear=True), patch.object(gemini, 'request_once') as request:
    output = stopped_run()
    request.assert_not_called()
    assert 'FREE_PROJECT_PROOF_EXPIRED' in output

diagnostic = gemini.safe_error_metadata(json.dumps({'error': {'code': 400,
    'status': 'INVALID_ARGUMENT', 'message': 'Unknown name "store": sentinel-sensitive test-key',
    'details': [{'reason': 'API_KEY_INVALID', 'metadata': {'key': 'test-key'}}]}}).encode())
assert diagnostic['diagnostic_codes'] == ['API_KEY_INVALID', 'UNKNOWN_FIELD:store']
assert 'sentinel-sensitive' not in json.dumps(diagnostic) and 'test-key' not in json.dumps(diagnostic)
with patch.dict(os.environ, ready_env, clear=True), patch.object(gemini, 'request_json_once',
        return_value=({'http': 400, 'api_success': False}, None)) as request, \
        patch.object(gemini, 'request_once') as generation, redirect_stdout(io.StringIO()) as output:
    try:
        gemini.probe()
    except SystemExit as error:
        assert error.code == 2
    else:
        raise AssertionError('Metadata error must stop before count/inference')
    request.assert_called_once()
    generation.assert_not_called()
    assert ':generateContent' not in request.call_args.args[1]
    assert '"inference_calls":0' in output.getvalue()

with patch.dict(os.environ, ready_env, clear=True), patch.object(gemini, 'request_once',
        return_value=({'http': 200, 'api_success': True}, {'response': '{"cells":[]}'})) as request, \
        patch.object(shared, 'parse_complete_cells', return_value=([], None)), \
        patch.object(gemini, 'sleep') as pause, redirect_stdout(io.StringIO()) as output:
    gemini.run(limit=1)
    request.assert_called_once()
    pause.assert_not_called()
    report = json.loads(output.getvalue().split('CBH_GEMINI_V2=')[1])
    assert report['maximum_requests'] == 1 and report['aggregate'] is None
    assert report['complete_v2'] is False
    assert report['method'] == 'SINGLE_ORIGINAL_REQUEST_DIAGNOSTIC'

print('FREE_OCR_OFFLINE_GUARDS_PASS corpus=12/336 parser=strict free_gate=closed quota_retry=0 network=0')
