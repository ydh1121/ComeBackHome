"""No inference: verify existing product geometry on unchanged synthetic pixels."""
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location('cbh_ocrspace_eval', Path(__file__).with_name('evaluate-ocrspace-free.py'))
evaluator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(evaluator)
images, _, _, _ = evaluator.shared.load_corpus()
detected = 0
physical_cells = 0
for entry, image in images:
    result = evaluator.decode(None, entry['id'], image)
    shape = result.get('pixel_shape')
    if shape is not None:
        assert shape['rows'] == entry['employee_rows'] and shape['cells'] == entry['cells'] * 3, entry['id']
        detected += 1
        physical_cells += shape['cells']
    # An unsupported raster must remain absent; only separately observed full
    # Markdown/overlay evidence can handle that input. No guessed pixel grid.
    assert result['cells'] == [] and result['error'] == 'PROVIDER_NOT_COMPLETE'
print(f'OCRSPACE_EXISTING_PRODUCT_PIXEL_CONTRACT_PASS detected_images={detected}/12 '
      f'unrecognized_images={12-detected} physical_cells={physical_cells} ocr_accuracy=NOT_MEASURED network=0')
