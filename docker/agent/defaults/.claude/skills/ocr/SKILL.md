---
name: ocr
description: Extract text, tables, key-value pairs, and structured fields from scanned PDFs, images, invoices, receipts, IDs, contracts, and tax forms using Azure Form Recognizer (via LLM Foundry). Use whenever a file cannot be read as plain text — e.g. scanned documents, photographs of pages, or forms.
---

The `ocr` MCP server exposes an `ocr_document` tool that sends documents to Azure Form Recognizer via LLM Foundry and returns extracted text and structured data.

---

## When to use

Use `ocr_document` whenever a file cannot be read as plain text:

- Scanned PDFs or images of printed/handwritten pages
- Forms, invoices, receipts, or tax documents the user uploads
- ID cards, business cards, health insurance cards
- Any document where `read_file` would return binary data or gibberish

Do **not** use it for native (text-layer) PDFs, plain `.txt`/`.md` files, or source code — those can be read directly.

---

## How to use

```python
ocr_document(file_path="/workspace/scan.pdf")
ocr_document(file_path="/workspace/invoice.pdf",  model="prebuilt-invoice")
ocr_document(file_path="receipt.jpg",             model="prebuilt-receipt")
```

**Parameters**

| Parameter | Type | Required | Default |
|-----------|------|----------|---------|
| `file_path` | string | yes | — |
| `model` | string | no | `prebuilt-layout` |

- `file_path` can be absolute or workspace-relative (e.g. `"report.pdf"` → `/workspace/report.pdf`).
- Supported formats: **PDF, PNG, JPG/JPEG, TIFF, BMP, HEIC, DOCX, XLSX, PPTX, HTML**
- Maximum file size: **50 MB**

---

## Choosing the right model

| Model | Use when… |
|---|---|
| `prebuilt-read` | You only need raw text, no structure. Fastest. |
| `prebuilt-layout` | You need text **plus** tables and checkboxes. Good default. |
| `prebuilt-document` | You also want key-value pairs and named entities automatically detected. |
| `prebuilt-invoice` | Document is a vendor invoice — extracts vendor name, items, totals, due date. |
| `prebuilt-receipt` | Document is a store/restaurant receipt — merchant, items, total, date. |
| `prebuilt-idDocument` | Passport or driver's licence — name, DOB, number, expiry. |
| `prebuilt-businessCard` | Business card — contact name, company, phone, email. |
| `prebuilt-contract` | Legal contract — parties, dates, clauses. |
| `prebuilt-healthInsuranceCard.us` | US health insurance card fields. |
| `prebuilt-tax.us.w2` | W-2 — box values (wages, taxes withheld, etc.). |
| `prebuilt-tax.us.1098` | 1098 mortgage interest statement. |
| `prebuilt-tax.us.1098E` | 1098-E student loan interest statement. |
| `prebuilt-tax.us.1098T` | 1098-T tuition payment statement. |

**Rule of thumb:** default to `prebuilt-layout`. Switch to a domain model only when you know the document type — domain models return structured fields instead of raw text.

---

## What you get back

The tool returns a human-readable string. Its structure depends on the model and document:

### Text (all models)

```
--- Page 1 ---
First line of text on the page
Second line of text
...

--- Page 2 ---
...
```

### Tables (`prebuilt-layout` and above)

Detected tables are appended after the page text:

```
--- Table 1 ---
Header A | Header B | Header C
Row 1 A  | Row 1 B  | Row 1 C
Row 2 A  | Row 2 B  | Row 2 C
```

Each cell is separated by ` | `. Merged cells may appear blank in the output.

### Key-value pairs (`prebuilt-document` and above)

```
--- Key-Value Pairs ---
  Invoice Number: INV-2024-0042
  Invoice Date: 2024-03-15
  Total Amount Due: $1,250.00
```

### Domain-specific fields (prebuilt-invoice, prebuilt-receipt, etc.)

```
--- prebuilt-invoice Fields ---
  VendorName: Acme Corp
  InvoiceDate: 2024-03-15
  InvoiceTotal: $1,250.00
  DueDate: 2024-04-15
  Items: Widget A × 5 @ $200 | Widget B × 1 @ $250
```

The exact field names match the Azure Form Recognizer schema for each model.

---

## Error cases

| Message starts with | Meaning |
|---|---|
| `Error: LLMFOUNDRY_TOKEN is not set` | The server `.env` is missing the token. Ask the user to run setup again. |
| `Error: File not found: …` | Path is wrong — check `/workspace/` prefix. |
| `Error: File too large` | File exceeds 50 MB. |
| `HTTP 4xx error` | Bad model name or unsupported file type. |
| `Network error` | LLM Foundry is unreachable. |

---

## Tips

- For multi-page PDFs the output includes one `--- Page N ---` section per page.
- If only a specific page matters, tell the user to extract it first (e.g. with `pdftk`) to reduce latency.
- Confidence scores are not included in the text output; the raw JSON is available by inspecting the tool response if needed.
- Run `prebuilt-read` first if you only need to check whether a document contains certain text — it's faster than `prebuilt-layout`.
