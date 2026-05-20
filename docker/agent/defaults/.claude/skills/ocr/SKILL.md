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

The tool returns a single human-readable string assembled from up to four sections,
in this fixed order: **Page text → Key-Value Pairs → Tables → Document Fields**.
Sections are omitted when empty. Falls back to raw JSON if nothing parsed.

All examples below are **real output** from running this tool against the
sample files. They are not made up — what you see is what the model actually returned.

### Page text (every model)

Sample response with `prebuilt-read`:

```
--- Page 1 ---
CORRECTED
FILER'S name, street address, city or town, state or province, country, ZIP or | 1 Payments received for
foreign postal code, and telephone number
HARVARDLIKE UNIVERSITY
2468 WANDERING LANE
BOSTON, PA 18733
8383
VOID
FILER'S federal identification no.
55-0000000
STUDENT'S social security number
246-81-0121
STUDENT'S name
URA STUDENT
Street address (including apt. no.)
456 ELM STREET
City or town, state or province, country, and ZIP or foreign postal code
MYTOWN, PA 19123
... (truncated)
$ 45,678.00
... (truncated)
$ 10,278.00
```

Each line is one OCR-detected line — order roughly top-to-bottom, but not always
strictly so (text reads in detection order, which can jump around column
boundaries on dense forms — see the layout example below for a starker case).

For PDFs, multiple `--- Page N ---` blocks appear in order.

### Tables (`prebuilt-layout` and above)

Each detected table is rendered as pipe-delimited rows after the page text.
The header line shows `--- Table N (rows x columns) ---`. Checkbox cells become
`:selected:` / `:unselected:` markers. Sample response with `prebuilt-layout`:

```
--- Table 1 (9x6) ---
FILER'S name, street address, city or town, state or province, country, ZIP or | foreign postal code, and telephone number |  |  | 1 Payments received for qualified tuition and related expenses $ 45,678.00 | OMB No. 1545-1574 2015 Form 1098-T | Tuition Statement
HARVARDLIKE UNIVERSITY 2468 WANDERING LANE BOSTON, PA 18733 |  |  |  |  |
 |  |  | 2 Amounts billed for qualified tuition and related expenses $ |  |
FILER'S federal identification no. 55-0000000 | STUDENT'S social security number 246-81-0121 |  | 3 Check if you have changed reporting method for 2015 | your :unselected: | Copy A For
... (truncated)
Service Provider/Acct. No. (see instr.) |  | 8 Check if at least half-time student :selected: | 9 Check if a graduate student :selected: X | 10 Ins. contract reimb./refund $ |
```

Empty trailing cells appear as `|  | ` and merged cells repeat their value or
appear blank in the columns they span — don't assume the column count of a row
matches the visual column count of the printed form.

### Key-Value Pairs (`prebuilt-document` and above)

Key-value pairs are extracted from form-style "label: value" pairs.
Sample response with `prebuilt-document`:

```
--- Key-Value Pairs ---
  RECIPIENT'S/LENDER'S name, street address, city of town, state of province, country, ZIP or lomign postal code,: Karen Store
6142 First Street
Dallas, TX 78678
  telephone no.: [123) 665-1234
  VOID: :unselected:
  CORRECTED: :unselected:
  OMB No.: 1545-1380
  1 Mortgage interest received from payerts4/borrowerts): 2523.13
  RECIPIENT 'S/LENDER 8 TIN: 1234512344
  PAYER'S/BORROWER'S TIN:
  2 Dublanding mortgage
principal: 89000.00
  4 Refund of overpaid: 18.00
```

Note: keys can include trailing punctuation, span multiple lines, and contain
OCR errors (e.g. "of town" instead of "or town", "lomign" instead of "foreign",
"Dublanding" instead of "Outstanding"). Always sanity-check key spelling before
relying on it programmatically.

### Document Fields (domain models: `prebuilt-invoice`, `prebuilt-receipt`, IDs, tax forms, …)

Domain models return structured fields with proper types: scalars are inlined,
nested objects render as `{ key1=val1, key2=val2 }`, and addresses are flattened
to comma-separated parts. Sample response with `prebuilt-tax.us.1098T`:

```
--- tax.us.1098T Fields ---
  AdjustmentsForPriorYear: $
  AmountBilledForTuition: $
  Filer: { Address=2468 WANDERING LANE, BOSTON, PA, 18733, Name=HARVARDLIKE UNIVERSITY, TIN=55-0000000, Telephone=8383 }
  IncludesAmountForNextPeriod: false
  InsuranceContractReimbursements: $
  IsAtLeastHalfTimeStudent: true
  IsCorrected: false
  IsGraduateStudent: true
  PaymentReceived: 45678.0
  Scholarships: 10278.0
  ScholarshipsAdjustments: $
  Student: { Address=456 ELM STREET, MYTOWN, PA, 19123, Name=URA STUDENT, TIN=246-81-0121 }
  TaxYear: 2015
```

Things to watch out for in the real output above:

- **Empty money fields show as a bare `$`** (the model picked up the dollar sign
  but no number was filled in). Treat `$` as "blank field," not "$0".
- **Booleans are normalized to `true` / `false` strings** for checkboxes — but
  the visual form may show an `X` that the model interprets either way; combine
  with key-value pair output to sanity-check.
- **Numeric fields drop currency symbols** — `PaymentReceived: 45678.0` came
  from `$ 45,678.00` on the form.
- **Field name set differs per model**. The exact names match the Azure Form
  Recognizer schema (see [Microsoft's docs](https://learn.microsoft.com/azure/ai-services/document-intelligence/) for the full list per model).

### When something goes wrong

The tool returns a string starting with one of:

- `Error: LLMFOUNDRY_TOKEN is not set` — server `.env` missing the token.
- `Error: File not found: /workspace/...` — path doesn't exist (check workspace-relative).
- `Error: File too large` — over 50 MB.
- `HTTP 4xx error from Form Recognizer: …` — bad model name, unsupported file
  type, or document corruption.
- `HTTP 500 error from Form Recognizer: …` — server-side bug in the proxy. Some
  combinations (e.g., `prebuilt-receipt` on certain PDFs) currently error out on
  the LLM Foundry side; fall back to `prebuilt-layout` and parse manually.
- `Network error contacting Form Recognizer: …` — LLM Foundry unreachable.

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
