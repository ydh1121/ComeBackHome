"""Reuse the immutable independent scorer, never pass truth to the browser."""
import base64
import importlib.util
import json
from pathlib import Path
import sys

spec = importlib.util.spec_from_file_location('shared', Path(__file__).with_name('evaluate-workers-ai-free.py'))
shared = importlib.util.module_from_spec(spec)
spec.loader.exec_module(shared)
images, truth, _, scorer = shared.load_corpus()
if sys.argv[1:] == ['--images']:
    print(json.dumps([{'id': e['id'], 'sha256': e['sha256'], 'base64': base64.b64encode(b).decode()} for e, b in images]))
else:
    data = json.load(sys.stdin)
    predictions = []
    for image in data['images']:
        cells = image.pop('cells')
        if data['browser'] == 'CHROMIUM':
            image['recognized_cells_before_review'] = cells
        predictions.extend(cells)
        subset = [cell for cell in truth if cell['source_image_id'] == image['id']]
        image['score'] = shared.score_with_original(scorer, subset, cells)
    data.update(corpus_sha256=shared.CORPUS_SHA, scorer_sha256=shared.SCORER_SHA,
                aggregate=shared.score_with_original(scorer, truth, predictions))
    print(json.dumps(data, separators=(',', ':')))
