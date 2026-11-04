// Tripo's state rulings (architecture, "State"): an account holds its credits; nothing the key test does moves it.
// Task status is the vendor's machine (queued, running, success, failed, cancelled, unknown, banned, expired).
// The task operations answer the gap, so this pack declares no task transition or stored task resource.
// The published task examples are outside the demanded integration; their sources are retained in spec/.
// source: https://raw.githubusercontent.com/VAST-AI-Research/tripo-python-sdk/4115894a0a603c5183c9ed6dc8662745562c8941/examples/image_to_model.py "create a 3D model from an image."
// source: https://raw.githubusercontent.com/VAST-AI-Research/tripo-python-sdk/4115894a0a603c5183c9ed6dc8662745562c8941/examples/multiview_to_model.py "create a 3D model from multiple view images."
// source: https://raw.githubusercontent.com/VAST-AI-Research/tripo-python-sdk/4115894a0a603c5183c9ed6dc8662745562c8941/examples/retarget_animation.py "apply animations to a rigged 3D model."
// source: https://raw.githubusercontent.com/VAST-AI-Research/tripo-python-sdk/4115894a0a603c5183c9ed6dc8662745562c8941/examples/rig_model.py "Rig a 3D model for animation."
// source: https://raw.githubusercontent.com/VAST-AI-Research/tripo-python-sdk/4115894a0a603c5183c9ed6dc8662745562c8941/examples/text_to_model.py "create a 3D model from text."
// source: https://raw.githubusercontent.com/VAST-AI-Research/tripo-python-sdk/4115894a0a603c5183c9ed6dc8662745562c8941/pyproject.toml "version = \"0.4.2\""
export const states = {};
