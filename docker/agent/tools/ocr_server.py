#!/usr/bin/env python3
"""MCP stdio server: Azure Form Recognizer OCR tool.

Zero external dependencies — uses only the Python standard library.
Claude Code loads this via .claude/mcp.json and communicates over stdin/stdout
using the MCP JSON-RPC protocol.
"""

import base64
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

SUPPORTED_MODELS = [
    "prebuilt-read",
    "prebuilt-layout",
    "prebuilt-document",
    "prebuilt-businessCard",
    "prebuilt-contract",
    "prebuilt-healthInsuranceCard.us",
    "prebuilt-idDocument",
    "prebuilt-invoice",
    "prebuilt-receipt",
    "prebuilt-tax.us.w2",
    "prebuilt-tax.us.1098",
    "prebuilt-tax.us.1098E",
    "prebuilt-tax.us.1098T",
]

MIME_MAP = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".bmp": "image/bmp",
    ".heic": "image/heic",
    ".heif": "image/heif",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".html": "text/html",
}

TOOLS = [
    {
        "name": "ocr_document",
        "description": (
            "Extract text, tables, key-value pairs, and structured fields from documents "
            "(PDFs, images, forms) using Azure Form Recognizer. "
            "Returns extracted text and structured data. "
            "Requires LLMFOUNDRY_TOKEN to be set in the environment."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "file_path": {
                    "type": "string",
                    "description": "Absolute path to the document file (PDF, PNG, JPG, TIFF, etc.)",
                },
                "model": {
                    "type": "string",
                    "description": (
                        "Form Recognizer prebuilt model. "
                        "Use 'prebuilt-layout' (default) for general documents with tables, "
                        "'prebuilt-read' for plain text, or a domain-specific model for "
                        "invoices, receipts, IDs, tax forms, etc."
                    ),
                    "enum": SUPPORTED_MODELS,
                    "default": "prebuilt-layout",
                },
            },
            "required": ["file_path"],
        },
    }
]


def _field_value_text(field) -> str:
    """Render a domain-model field value (possibly nested) as one inline string."""
    if not isinstance(field, dict):
        return "" if field is None else str(field)

    vtype = field.get("value_type") or field.get("type")
    value = field.get("value")
    content = field.get("content") or ""

    if vtype == "dictionary" and isinstance(value, dict):
        sub = [f"{k}={_field_value_text(v)}" for k, v in sorted(value.items())]
        return "{ " + ", ".join(s for s in sub if s.split("=", 1)[1]) + " }"
    if vtype == "address" and isinstance(value, dict):
        parts = []
        if value.get("house_number") and value.get("road"):
            parts.append(f"{value['house_number']} {value['road']}")
        elif value.get("street_address"):
            parts.append(value["street_address"])
        for k in ("city", "state", "postal_code", "country_region"):
            if value.get(k):
                parts.append(str(value[k]))
        return ", ".join(parts) or content
    if vtype in ("selectionMark", "selection_mark"):
        return str(value) if value is not None else content
    if vtype == "array" and isinstance(value, list):
        return "[" + ", ".join(_field_value_text(v) for v in value) + "]"
    if vtype == "currency" and isinstance(value, dict):
        amt = value.get("amount")
        sym = value.get("currency_symbol") or value.get("currency_code") or ""
        return f"{sym}{amt}" if amt is not None else content

    if value is not None and value != "":
        return str(value)
    return content


def _format_result(result: dict) -> str:
    """Convert Form Recognizer JSON response into readable text.

    Handles the flat v2023-07-31 schema (snake_case) returned by LLM Foundry
    and falls back to the legacy camelCase analyzeResult.* schema if present.
    """
    # New schema is flat; legacy nests fields under analyzeResult.
    ar = result.get("analyzeResult", result)
    parts: list[str] = []

    # ---- Per-page line text ---------------------------------------------------
    pages = ar.get("pages", [])
    for page in pages:
        page_num = page.get("page_number", page.get("pageNumber", "?"))
        lines = [(ln.get("content") or "").strip() for ln in page.get("lines", [])]
        lines = [ln for ln in lines if ln]
        if lines:
            parts.append(f"--- Page {page_num} ---\n" + "\n".join(lines))

    # ---- Key-value pairs (prebuilt-document and above) -----------------------
    kv_pairs = ar.get("key_value_pairs") or ar.get("keyValuePairs") or []
    kv_lines = []
    for pair in kv_pairs:
        key_obj = pair.get("key") or {}
        val_obj = pair.get("value") or {}
        key = (key_obj.get("content") or "").strip()
        val = (val_obj.get("content") or "").strip() if val_obj else ""
        if key:
            kv_lines.append(f"  {key}: {val}")
    if kv_lines:
        parts.append("--- Key-Value Pairs ---\n" + "\n".join(kv_lines))

    # ---- Tables ---------------------------------------------------------------
    tables = ar.get("tables", [])
    for i, table in enumerate(tables, 1):
        rows: dict[int, dict[int, str]] = {}
        for cell in table.get("cells", []):
            r = cell.get("row_index", cell.get("rowIndex", 0))
            c = cell.get("column_index", cell.get("columnIndex", 0))
            content = (cell.get("content") or "").replace("\n", " ").strip()
            rows.setdefault(r, {})[c] = content
        if rows:
            max_col = max(max(cols.keys()) for cols in rows.values()) + 1
            text_rows = []
            for r in sorted(rows.keys()):
                row_cells = [rows[r].get(c, "") for c in range(max_col)]
                text_rows.append(" | ".join(row_cells))
            parts.append(
                f"--- Table {i} ({table.get('row_count', len(rows))}x{table.get('column_count', max_col)}) ---\n"
                + "\n".join(text_rows)
            )

    # ---- Documents (domain models: invoice, receipt, IDs, tax forms, …) ------
    docs = ar.get("documents", [])
    for doc in docs:
        doc_type = doc.get("doc_type", doc.get("docType", "document"))
        fields = doc.get("fields", {})
        if not fields:
            continue
        field_lines = []
        for field_name in sorted(fields):
            text = _field_value_text(fields[field_name])
            if text:
                field_lines.append(f"  {field_name}: {text}")
        if field_lines:
            parts.append(f"--- {doc_type} Fields ---\n" + "\n".join(field_lines))

    return "\n\n".join(parts) if parts else json.dumps(result, indent=2)


def ocr_document(file_path: str, model: str = "prebuilt-layout") -> str:
    token = os.environ.get("LLMFOUNDRY_TOKEN", "").strip()
    if not token:
        return (
            "Error: LLMFOUNDRY_TOKEN is not set. "
            "Ask the administrator to set LLMFOUNDRY_TOKEN in the server .env file."
        )

    path = Path(file_path)
    if not path.is_absolute():
        path = Path("/workspace") / path
    if not path.exists():
        return f"Error: File not found: {path}"

    suffix = path.suffix.lower()
    mime = MIME_MAP.get(suffix, "application/octet-stream")

    try:
        raw = path.read_bytes()
    except OSError as exc:
        return f"Error reading file: {exc}"

    if len(raw) > 50 * 1024 * 1024:
        return f"Error: File too large ({len(raw) // 1024 // 1024} MB). Maximum is 50 MB."

    data_b64 = base64.b64encode(raw).decode()
    document = f"data:{mime};base64,{data_b64}"

    payload = json.dumps({"model": model, "document": document}).encode()
    req = urllib.request.Request(
        "https://llmfoundry.straivedemo.com/azureformrecognizer/analyze",
        data=payload,
        headers={
            "Authorization": f"Bearer {token}:ocr-tool",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            result = json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        body = exc.read().decode(errors="replace")
        return f"HTTP {exc.code} error from Form Recognizer: {body}"
    except urllib.error.URLError as exc:
        return f"Network error contacting Form Recognizer: {exc.reason}"
    except Exception as exc:
        return f"Unexpected error: {exc}"

    return _format_result(result)


# ---------------------------------------------------------------------------
# Minimal MCP JSON-RPC 2.0 over stdio
# ---------------------------------------------------------------------------

def _respond(req_id, result=None, error=None) -> dict:
    resp: dict = {"jsonrpc": "2.0", "id": req_id}
    if error is not None:
        resp["error"] = error
    else:
        resp["result"] = result if result is not None else {}
    return resp


def handle(request: dict) -> dict | None:
    method = request.get("method", "")
    req_id = request.get("id")

    if method == "initialize":
        return _respond(req_id, {
            "protocolVersion": "2024-11-05",
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "ocr-tool", "version": "1.0.0"},
        })

    if method in ("notifications/initialized", "notifications/cancelled"):
        return None  # notifications have no response

    if method == "ping":
        return _respond(req_id, {})

    if method == "tools/list":
        return _respond(req_id, {"tools": TOOLS})

    if method == "tools/call":
        params = request.get("params", {})
        name = params.get("name", "")
        args = params.get("arguments", {})
        if name == "ocr_document":
            text = ocr_document(
                file_path=args.get("file_path", ""),
                model=args.get("model", "prebuilt-layout"),
            )
            is_error = text.startswith("Error")
            return _respond(req_id, {
                "content": [{"type": "text", "text": text}],
                "isError": is_error,
            })
        return _respond(req_id, error={"code": -32601, "message": f"Unknown tool: {name}"})

    if req_id is not None:
        return _respond(req_id, error={"code": -32601, "message": f"Method not found: {method}"})
    return None


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
        except json.JSONDecodeError:
            continue
        response = handle(request)
        if response is not None:
            print(json.dumps(response), flush=True)


if __name__ == "__main__":
    main()
