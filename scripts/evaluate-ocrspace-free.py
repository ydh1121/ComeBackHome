"""Original immutable v2 evaluated through the reusable Engine 3 adapter.

Only numeric/status/hash evidence is printed. No new corpus, scorer, truth-aware
normalization, retries, raw response artifacts or product writes.
"""
import argparse
import base64
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess

spec = importlib.util.spec_from_file_location('cbh_ocrspace', Path(__file__).with_name('probe-ocrspace-free.py'))
provider = importlib.util.module_from_spec(spec)
spec.loader.exec_module(provider)
shared = provider.shared
ADAPTER = shared.ROOT / 'src/providers/import/OcrSpaceWeeklyTable.ts'


def decode(response, image_id, image=None):
    try:
        raster = None
        if image is not None:
            from PIL import Image
            with Image.open(io.BytesIO(image)) as source:
                if source.width * source.height > 4_000_000:
                    raise ValueError('RASTER_TOO_LARGE')
                raster = {'width': source.width, 'height': source.height,
                          'luminance': base64.b64encode(source.convert('L').tobytes()).decode('ascii')}
        result = subprocess.run(['node', '--disable-warning=ExperimentalWarning',
            str(Path(__file__).with_name('parse-ocrspace-response.mjs'))],
            input=json.dumps({'response': response, 'image_id': image_id, 'raster': raster}),
            capture_output=True, text=True, timeout=30,
            # Provider secrets must not be inherited by the parser subprocess.
            env={'PATH': os.environ.get('PATH', '')})
        if result.returncode or len(result.stdout) > 2 * 1024 * 1024:
            raise ValueError('ADAPTER_FAILURE')
        value = json.loads(result.stdout)
        if not isinstance(value, dict) or not isinstance(value.get('cells'), list):
            raise ValueError('ADAPTER_SHAPE')
        return value
    except Exception:
        return {'cells': [], 'error': 'ADAPTER_PROCESS_FAILURE', 'diagnostics': {}}


def run():
    if not provider.readiness()['ready']:
        print('CBH_OCRSPACE_PREFLIGHT=' + json.dumps(provider.readiness()), flush=True)
        raise SystemExit(2)
    images, truth, _, scorer = shared.load_corpus()
    report = {'provider': 'OCRSPACE', 'engine': 3, 'method': 'COMPLETE_ORIGINAL_V2',
        'corpus_sha256': shared.CORPUS_SHA, 'scorer_sha256': shared.SCORER_SHA,
        'adapter_sha256': shared.sha(ADAPTER.read_bytes()), 'maximum_requests': 12,
        'geometry_module_sha256': {name: shared.sha((shared.ROOT / 'src/providers/import' / name).read_bytes())
            for name in ('ScheduleTableStructureDetector.ts', 'Weekly3ColumnScheduleMatrix.ts')},
        'raster_decoder': 'Pillow12.3.0_NATIVE_SIZE_LUMINANCE_ONLY_API_IMAGE_UNCHANGED',
        'prior_probe_requests': 1, 'prior_complete_evaluation_requests': 24,
        'maximum_execution_requests_including_probe': 37,
        'adapter_variant': 'EXISTING_PRODUCT_PIXEL_MATRIX_PLUS_OBSERVED_OCR_TEXT',
        'images': [], 'billed_conversions': None, 'remaining_conversions': None,
        'private_images': 0, 'production_writes': 0, 'paid_fallback': False,
        'field_provenance': {
            'image_id': 'INPUT_METADATA', 'row_column': 'OBSERVED_MARKDOWN_AND_EXISTING_PRODUCT_PIXEL_MATRIX',
            'date_name_times_status': 'OCR_TEXT_PLUS_DETERMINISTIC_ADAPTER',
            'weekday': 'CALENDAR_OF_OBSERVED_FULL_DATE',
            'review_required': 'PROVIDER_UNSUPPORTED_NULL_NOT_FORCED_TRUE',
            'evidence_bbox': 'EXISTING_PRODUCT_PIXEL_MATRIX_OR_OBSERVED_OVERLAY_OR_NULL'},
        'acceptance': 'NOT_ACCEPTED_BY_BENCHMARK_ALONE'}
    predictions = []
    attempted_truth = []
    for entry, image in images:
        if not provider.readiness()['ready']:
            report['blocker'] = 'FREE_KEY_PROOF_EXPIRED'
            break
        item, response = provider.request_response_once(os.environ['OCRSPACE_API_KEY'].strip(), image)
        item.update(image_id=entry['id'], image_sha256=entry['sha256'])
        if item['api_success']:
            parsed = decode(response, entry['id'], image)
            cells = parsed['cells']
            subset = [cell for cell in truth if cell['source_image_id'] == entry['id']]
            item.update(parse_error=parsed['error'], adapter_shape=parsed['diagnostics'], pixel_shape=parsed.get('pixel_shape'),
                predicted_cells=len(cells), cells_with_bounds=sum(cell.get('evidence_bbox') is not None for cell in cells),
                score=shared.score_with_original(scorer, subset, cells))
            predictions.extend(cells)
            attempted_truth.extend(subset)
        report['images'].append(item)
        print('CBH_OCRSPACE_IMAGE=' + json.dumps(item, separators=(',', ':')), flush=True)
        if not item['api_success']:
            report['blocker'] = 'PROVIDER_FAILURE_STOP_NO_RETRY'
            break
    report['requests_attempted'] = len(report['images'])
    report['successful_conversions'] = sum(item['api_success'] for item in report['images'])
    report['complete_v2'] = len(report['images']) == 12 and not report.get('blocker')
    report['aggregate'] = shared.score_with_original(scorer, truth, predictions) if report['complete_v2'] else None
    report['attempted_subset_score'] = shared.score_with_original(scorer, attempted_truth, predictions) if attempted_truth else None
    print('CBH_OCRSPACE_V2=' + json.dumps(report, separators=(',', ':')), flush=True)
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
        print('CBH_OCRSPACE_PREFLIGHT=' + json.dumps(provider.readiness()))
