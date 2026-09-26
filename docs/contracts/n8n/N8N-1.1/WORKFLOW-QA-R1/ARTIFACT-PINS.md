# ARTIFACT-PINS.md -- Identity check for inputs and committed bundle blobs

This bundle is the QA review of the N8N/1.1 SLA Reminder workflow
export produced by the n8n AI Assistant on n8n-crm and the matching
final-output execution evidence. This document records both the
**source-artifact pins** (SHA-256 over the raw bytes T0 delivered to
T1-A) and the **committed-blob pins** (SHA-256 over the bytes
committed to the QA branch, after strict-UTF-8/LF policy
normalization).

## Source artifacts (raw bytes from T0)

| Artifact | SHA-256 | Expected pin | Match |
| --- | --- | --- | --- |
| Workflow export `CRM — SLA Reminder — N8N_1.1 — Draft.json` | `f1afa2b9c152a709e4c4db150cf2631bd6cff28665d31f95be274e0ee31dfef0` | `f1afa2b9c152a709e4c4db150cf2631bd6cff28665d31f95be274e0ee31dfef0` | **MATCH** |
| Final-output (execution-7) `Pasted text.txt` | `5a3f07e89a0d27a1e41a055fbde9d7646d9d74fd7eb438ede7d6cfb51859d9dd` | `5a3f07e89a0d27a1e41a055fbde9d7646d9d74fd7eb438ede7d6cfb51859d9dd` | **MATCH** |

The original source path of each artifact is recorded as
`OWNER/N8N_REPORT_PROVIDED` (T0's hand-off location). The bundle
deliberately does NOT record the absolute Windows path here, in
compliance with the strict policy
("Khong chua duong dan may tuyet doi trong committed evidence; duong
dan nguon chi ghi duoi dang local input provenance da redacted neu
can"). The relative paths inside the bundle are:

| Source filename | Bundle path |
| --- | --- |
| `CRM — SLA Reminder — N8N_1.1 — Draft.json` | `docs/contracts/n8n/N8N-1.1/WORKFLOW-QA-R1/workflow.json` |
| `Pasted text.txt` | `docs/contracts/n8n/N8N-1.1/WORKFLOW-QA-R1/final-output.execution-7.json` |

## Committed bundle blobs

These are the bytes that land in the QA branch. The encoding policy
is strict UTF-8 no BOM and LF-only line endings. Any deviation is
rejected by `verify-encoding.ps1`.

| Bundle path | SHA-256 | Bytes | Encoding |
| --- | --- | --- | --- |
| `workflow.json` | `f1afa2b9c152a709e4c4db150cf2631bd6cff28665d31f95be274e0ee31dfef0` | 47726 | UTF-8 no BOM, LF-only (input was already LF) |
| `final-output.execution-7.json` | `8094bc481534e02df0e4bcdc56304bdff56082067cc7ed47860659c22ce5eec0` | 12853 | UTF-8 no BOM, LF-only (input was CRLF, normalized by stripping CR bytes) |

## Notes

- The `workflow.json` source already used LF line endings, so its
  committed hash equals the source pin.
- The `final-output.execution-7.json` source used CRLF line endings
  (Windows-pasted). After LF-normalization (CR bytes stripped,
  other bytes preserved), the committed hash differs from the
  source pin by exactly the number of removed CR bytes.
  This normalization is the standard `.git` autocrlf-equivalent
  sanitization mandated by the encoding policy
  (`.ai-pipeline/ENCODING-POLICY.md`).
- QA-01 (`Artifact identity`) ran the SHA-256 check against the
  **raw source bytes** and confirmed 2/2 MATCH against the expected
  pins. The committed blob hashes are recorded for the
  manifest-reproduction gate, which hashes **committed** bytes.
