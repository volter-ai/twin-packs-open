"""Write the SDK's declared HTTP surface from the retained pinned reference bytes.

Run from the packs repository root: python3 tripo/spec/write-spec.py
The SDK publishes no OpenAPI document. This translation declares only what its
client sends and parses; SDK defaults are not asserted to be server defaults.
"""
import ast
import gzip
import json
from pathlib import Path

SPEC = Path(__file__).resolve().parent
PIN = "4115894a0a603c5183c9ed6dc8662745562c8941"
UPSTREAM = f"https://raw.githubusercontent.com/VAST-AI-Research/tripo-python-sdk/{PIN}/"


def page(name):
    return gzip.decompress((SPEC / name).read_bytes()).decode()


client = ast.parse(page("sdk-client.html.gz"))
model = ast.parse(page("sdk-models.html.gz"))
methods = {n.name: n for n in ast.walk(client) if isinstance(n, ast.AsyncFunctionDef)}
enums = {
    n.name: [ast.literal_eval(a.value) for a in n.body if isinstance(a, ast.Assign)]
    for n in model.body if isinstance(n, ast.ClassDef) and any(
        isinstance(b, ast.Name) and b.id == "Enum" for b in n.bases
    )
}


def schema(node):
    """The published type hint, without pretending client checks are server rules."""
    if isinstance(node, ast.Subscript):
        kind = ast.unparse(node.value)
        args = node.slice.elts if isinstance(node.slice, ast.Tuple) else [node.slice]
        if kind == "Optional":
            return {**schema(args[0]), "nullable": True}
        if kind == "Literal":
            values = [ast.literal_eval(a) for a in args]
            return {"type": "string", "enum": values}
        if kind == "List":
            return {"type": "array", "items": schema(args[0])}
        if kind == "Union":
            return {"oneOf": [schema(a) for a in args]}
        if kind == "Dict":
            return {"type": "object", "additionalProperties": True}
    name = ast.unparse(node)
    if name in enums:
        return {"type": "string", "enum": enums[name]}
    if name == "TaskOutput":
        return {"$ref": "#/components/schemas/TaskOutput"}
    return {"type": {"str": "string", "int": "integer", "float": "number", "bool": "boolean"}.get(name, "object")}


def fields(name):
    cls = next(n for n in model.body if isinstance(n, ast.ClassDef) and n.name == name)
    members = [n for n in cls.body if isinstance(n, ast.AnnAssign)]
    return {
        "type": "object",
        "properties": {n.target.id: schema(n.annotation) for n in members},
        "required": [n.target.id for n in members if not (
            isinstance(n.annotation, ast.Subscript) and ast.unparse(n.annotation.value) == "Optional"
        )],
    }


def obj(properties, required=()):
    return {"type": "object", "properties": properties, **({"required": list(required)} if required else {})}


def envelope(data):
    return obj({"code": {"type": "integer"}, "data": data}, ("code", "data"))


def union_variants(variants):
    """A multiplexed key admits every helper's schema, regardless of order."""
    unique = {json.dumps(v, sort_keys=True): v for v in variants}
    values = list(unique.values())
    if len(values) == 1:
        return values[0]
    # Scalars that differ only by enum/nullable share one union of their values.
    bases = [{k: v for k, v in value.items() if k not in ("enum", "nullable")} for value in values]
    if all(base == bases[0] for base in bases):
        merged = dict(bases[0])
        if all("enum" in value for value in values):
            merged["enum"] = sorted({item for value in values for item in value["enum"]})
        if any(value.get("nullable") for value in values):
            merged["nullable"] = True
        return merged
    # Different types or object/array shapes are alternatives, not first-wins.
    # anyOf permits overlapping alternatives, unlike an exclusive oneOf.
    return {"anyOf": sorted(values, key=lambda value: json.dumps(value, sort_keys=True))}


file_content = obj({
    "type": {"type": "string"}, "url": {"type": "string"},
    "file_token": {"type": "string"},
    "object": obj({"bucket": {"type": "string"}, "key": {"type": "string"}}),
})
task_properties = {"type": {"type": "string", "description": "The task kind; create_task also accepts custom task data."}}
task_variants = {}
flows = []
for name, method in methods.items():
    if name.startswith("_") or name in {"create_task", "get_task", "get_balance", "close", "upload_file", "wait_for_task", "download_task_models", "download_rendered_image"}:
        continue
    # Every task helper delegates to create_task; segment v2 additionally uses v3.
    if not any(isinstance(n, ast.Attribute) and n.attr == "create_task" for n in ast.walk(method)):
        continue
    properties = {a.arg: schema(a.annotation) for a in method.args.args if a.arg != "self"}
    kinds = [ast.literal_eval(v) for n in ast.walk(method) if isinstance(n, ast.Dict)
             for k, v in zip(n.keys, n.values) if isinstance(k, ast.Constant) and k.value == "type" and isinstance(v, ast.Constant)]
    properties["type"] = {"type": "string", "enum": list(dict.fromkeys(kinds))}
    if "image" in properties:
        properties.pop("image")
        properties["file"] = file_content
    if "images" in properties:
        properties.pop("images")
        properties["files"] = {"type": "array", "items": file_content}
    for key in ("file", "files"):
        if key in properties:
            properties[key] = file_content if key == "file" else {"type": "array", "items": file_content}
    if name in {"text_to_model", "image_to_model", "multiview_to_model", "texture_model"}:
        properties["compress"] = {"type": "string", "enum": ["geometry"], "description": "The SDK translates compress=True to geometry; False is omitted."}
    if name == "texture_model":
        for key in ("text_prompt", "image_prompt", "style_image"):
            properties.pop(key)
        properties["texture_prompt"] = obj({"text": {"type": "string"}, "image": file_content, "style_image": file_content})
    if name == "retarget_animation":
        properties["animations"] = {"type": "array", "items": schema(ast.Name(id="Animation"))}
        properties["animation"] = schema(ast.Name(id="Animation"))
    flows.append({"method": name, "source": UPSTREAM + "tripo3d/client.py", "schema": obj(properties)})
    for key, value in properties.items():
        # A property's variants differ by task kind: preserve all in the flow table,
        # without narrowing create_task's arbitrary dictionary to one helper.
        if key != "type":
            task_variants.setdefault(key, []).append(value)

task_properties.update({key: union_variants(values) for key, values in task_variants.items()})

error = obj({"code": {"type": "integer"}, "message": {"type": "string"}, "suggestion": {"type": "string"}})


def operation(op_id, summary, data, source, body=None, media="application/json", parameters=None):
    op = {"operationId": op_id, "summary": summary, "x-source": source,
          "responses": {"200": {"description": "The SDK reads the JSON data envelope; no other success status is specified.",
                                 "content": {"application/json": {"schema": envelope(data)}}}}}
    if body:
        op["requestBody"] = {"required": True, "content": {media: {"schema": body}}}
    if parameters:
        op["parameters"] = parameters
    return op


task_id = obj({"task_id": {"type": "string"}}, ("task_id",))
task_param = [{"name": "task_id", "in": "path", "required": True, "schema": {"type": "string"}}]
upload_body = obj({"file": {"type": "string", "format": "binary"}}, ("file",))
balance = fields("Balance")
balance["properties"]["balance"]["description"] = "Available balance"
balance["properties"]["frozen"]["description"] = "Frozen amount"
task_output = fields("TaskOutput")
# from_dict maps these wire keys into the convenience dataclass attributes.
for key in ("image", "front_view_url", "left_view_url", "back_view_url", "right_view_url"):
    task_output["properties"].pop(key)
task_output["properties"].update({"generated_image": {"type": "string", "nullable": True}, "image": {"type": "string", "nullable": True},
    "generate_multiview_image": obj({k: {"type": "string", "nullable": True} for k in ("front_view_url", "left_view_url", "back_view_url", "right_view_url")})})
v3_task = fields("Task")
v3_task["required"] = ["task_id", "type", "status"]
v3_task["properties"]["created_at"] = {"oneOf": [{"type": "string"}, {"type": "number"}]}
v3_output = {**task_output, "properties": {**task_output["properties"], **{k: {"type": "string", "nullable": True} for k in ("model_url", "base_model_url", "pbr_model_url", "rendered_image_url")}}}
v3_task["properties"]["output"] = v3_output
paths = {
    "/v2/openapi/user/balance": {"get": operation("getBalance", "Get the user's account balance.", balance, UPSTREAM + "docs/API.md")},
    "/v2/openapi/task": {"post": operation("createTask", "Create a task.", task_id, UPSTREAM + "tripo3d/client.py", obj(task_properties))},
    "/v2/openapi/task/{task_id}": {"get": operation("getTask", "Get the status of a task.", {"$ref": "#/components/schemas/Task"}, UPSTREAM + "tripo3d/client.py", parameters=task_param)},
    "/v2/openapi/upload": {"post": operation("uploadFile", "Upload a file to the API using multipart form data.", obj({"image_token": {"type": "string"}}, ("image_token",)), UPSTREAM + "tripo3d/client_impl/aiohttp_client_impl.py", upload_body, "multipart/form-data")},
    "/v2/openapi/upload/sts/token": {"post": operation("createUploadToken", "Get temporary S3 upload credentials.", obj({k: {"type": "string"} for k in ("s3_host", "sts_ak", "sts_sk", "session_token", "resource_bucket", "resource_uri")}, ("s3_host", "sts_ak", "sts_sk", "session_token", "resource_bucket", "resource_uri")), UPSTREAM + "tripo3d/client.py", obj({"format": {"type": "string"}}, ("format",)))},
    "/v3/files": {"post": operation("uploadFileV3", "Upload via apiv3 POST /v3/files and return file_<uuid> token.", obj({"file_token": {"type": "string"}}, ("file_token",)), UPSTREAM + "tripo3d/client.py", upload_body, "multipart/form-data")},
    "/v3/tasks/{task_id}": {"get": operation("getTaskV3", "Query task via apiv3.", v3_task, UPSTREAM + "tripo3d/client.py", parameters=task_param)},
    "/v3/mesh/segment": {"post": operation("segmentMeshV3", "Segment a 3D model using segment v2.", task_id, UPSTREAM + "tripo3d/client.py", obj({"type": {"type": "string", "enum": ["mesh_segmentation"]}, "model": {"type": "string", "enum": ["v2.0-20260430"]}, "input": {"type": "string"}, "segmentation_granularity": {"type": "string"}, "ref_image": {"type": "string"}, "split_by_connectivity": {"type": "boolean"}}, ("type", "model", "input")))},
}
for path, methods_by_verb in paths.items():
    for op in methods_by_verb.values():
        op["servers"] = [{"url": host} for host in (
            ["https://openapi.tripo3d.ai", "https://openapi.tripo3d.com"] if path.startswith("/v3/")
            else ["https://api.tripo3d.ai", "https://api.tripo3d.com"]
        )]
document = {
    "openapi": "3.0.2", "info": {"title": "Tripo SDK-declared API", "version": "0.4.2",
        "description": f"HTTP operations declared by Tripo's official Python SDK at {PIN}. See SOURCE.md for translation boundaries."},
    "servers": [{"url": "https://api.tripo3d.ai"}],
    "components": {"securitySchemes": {"bearer": {"type": "http", "scheme": "bearer", "description": "API key must start with tsk_"}},
        "schemas": {"Balance": balance, "Task": fields("Task"), "TaskOutput": task_output, "Error": error}},
    "security": [{"bearer": []}], "paths": paths, "x-sdk-task-flows": flows,
}
(SPEC / "openapi.json").write_text(json.dumps(document, indent=2) + "\n")
print(f"wrote {len(paths)} paths / {sum(len(m) for m in paths.values())} operations from SDK {PIN}")
