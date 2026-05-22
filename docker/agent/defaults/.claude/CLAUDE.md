# Agent Instructions

These instructions apply to every Claude Code session running in this environment.

---

## General Behavior

**Before responding to any user query, always begin by listing the files in the current working directory** (e.g., using `ls` or `find .`). Use the files present to inform and ground your answer. If one or more relevant files exist, read **all of them** before responding — do not stop at the first file that seems useful. Multiple files may together provide a more complete answer than any single file alone. Use the combined contents as the primary basis for your response — do not rely solely on assumptions or general knowledge when project-specific files are available.

**Always cite the source file(s) used when forming your response.** For every claim, fact, or detail drawn from a file, reference the filename (and line number where applicable) inline — e.g., `[src/config.py:42]` or `[src/source.pdf:page 5 table 1]` or `[README.md]`. If information is synthesized from multiple files, cite each contributing file. This makes it easy to trace answers back to their origin.

---

## Available skill — `ocr`

This environment ships a built-in **`ocr` skill** backed by the **`ocr_document` MCP tool** (server name: `ocr`). It extracts text, tables, key-value pairs, and structured fields from documents using **Azure Form Recognizer** via the Straive LLM Foundry proxy.

**When to use it:**

- The user shares a **scanned PDF**, photo of a page, or any image containing text you can't read directly.
- The file is a **form, invoice, receipt, ID, contract, business card, health-insurance card, or tax document** (W-2, 1098, 1098-E, 1098-T).
- You attempted `Read` on a PDF/image and got binary garbage, or a vision tool can see the image but you need exact text/numbers/tables.

**When NOT to use it:**

- Native text-layer PDFs, plain `.txt`/`.md` files, or source code — read those directly with `Read`.
- The user hasn't shared any document — don't run OCR speculatively.

**Models** (pass via the `model` parameter, default `prebuilt-layout`):

| Model | Use case |
|---|---|
| `prebuilt-read` | Fastest path — raw text only. |
| `prebuilt-layout` | Default. Text + tables + selection marks. |
| `prebuilt-document` | Adds key-value pairs and entities. |
| `prebuilt-invoice` / `prebuilt-receipt` | Structured vendor/total/line-items extraction. |
| `prebuilt-idDocument` / `prebuilt-businessCard` | Identity / contact fields. |
| `prebuilt-contract` | Parties, dates, clauses. |
| `prebuilt-healthInsuranceCard.us` | US insurance card fields. |
| `prebuilt-tax.us.w2` / `.1098` / `.1098E` / `.1098T` | US tax forms. |

See `~/.claude/skills/ocr/SKILL.md` for the full reference (output format, error messages, etc.).
