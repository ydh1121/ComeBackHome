# Pinned weekly Korean Paddle OCR model

Source: https://huggingface.co/PaddlePaddle/korean_PP-OCRv5_mobile_rec_onnx
Model: korean_PP-OCRv5_mobile_rec / inference.onnx
Model SHA-256: 92f0b7785e64fc9090106a241cf4c1eb97472824558272751b88a2a4476d3a08
Dictionary generation: official upstream inference.yml -> PostProcess.character_dict, preserve order, append one trailing CTC space token, json.dumps(ensure_ascii=False).
Dictionary: exactly 11946 characters; SHA-256: 8aa03fad51cd719c83590dfc4d7e3edea6f2a01f07a08fc476250f42322bb403.
License: Apache-2.0 (official Hugging Face model repository metadata; see LICENSE).
App inference: onnxruntime-web@1.23.2, copied from installed dependency at each production build. Do not vendor ORT binaries.
Contains only upstream public model and official character dictionary. No private user images, crops, ground truth or data.
