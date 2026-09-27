#!/usr/bin/env node
/**
 * validate-n8n-envelopes.mjs -- N8N/1.1 envelope validator entrypoint.
 *
 * Purpose (per T0 R2 directive):
 *   "Prepare a test entrypoint allowing T1-A / T0 to input envelope
 *    exports from n8n into the validator and receive PASS / FAIL
 *    according to AutomationRequestSchema."
 *
 * Usage:
 *   node scripts/validate-n8n-envelopes.mjs <envelope1.json> [<envelope2.json> ...]
 *
 * Encoding policy (per .ai-pipeline/ENCODING-POLICY.md):
 *   - UTF-8 BOM (EF BB BF) is rejected outright -- no stripping.
 *   - UTF-16 LE BOM (FF FE) and UTF-16 BE BOM (FE FF) are rejected.
 *   - Bytes are decoded with strict UTF-8; invalid UTF-8 sequences
 *     fail closed.
 *   - The output stream gets a final newline.
 *
 * Behaviour:
 *   - For each input file:
 *       PASS  <file>  -- envelope parsed and schema-valid
 *       FAIL  <file>  -- <reason>
 *   - Exit code:
 *       0  -- all inputs PASS
 *       1  -- at least one FAIL
 *       2  -- usage error (no files)
 *
 * No HTTP, no DB, no Docker. Pure schema check against a local
 * in-process Zod schema.
 *
 * Strict UTF-8 no BOM.
 */

import { readFileSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import process from 'node:process';
import { AutomationRequestSchema } from '../dist/automation/index.js';

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const UTF16_LE_BOM = Buffer.from([0xff, 0xfe]);
const UTF16_BE_BOM = Buffer.from([0xfe, 0xff]);

function detectBomReason(buf) {
  if (buf.length >= 3 && buf[0] === UTF8_BOM[0] && buf[1] === UTF8_BOM[1] && buf[2] === UTF8_BOM[2]) {
    return 'UTF-8 BOM (EF BB BF) detected; strict UTF-8 no BOM required';
  }
  if (buf.length >= 2 && buf[0] === UTF16_LE_BOM[0] && buf[1] === UTF16_LE_BOM[1]) {
    return 'UTF-16 LE BOM (FF FE) detected; strict UTF-8 no BOM required';
  }
  if (buf.length >= 2 && buf[0] === UTF16_BE_BOM[0] && buf[1] === UTF16_BE_BOM[1]) {
    return 'UTF-16 BE BOM (FE FF) detected; strict UTF-8 no BOM required';
  }
  return null;
}

// decodeStrict: decode a Buffer as strict UTF-8 without stripping any
// leading BOM. Throws if invalid UTF-8 is encountered.
function decodeStrictUtf8(buf) {
  // Buffer.toString('utf8') uses the WHATWG replacement algorithm in
  // Node.js >= 18, which silently substitutes invalid sequences. We
  // re-implement strict decoding by walking the buffer and rejecting
  // any invalid byte sequences.
  const bytes = new Uint8Array(buf.length);
  for (let i = 0; i < buf.length; i += 1) bytes[i] = buf[i];
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
  try {
    return decoder.decode(bytes);
  } catch (err) {
    throw new Error('invalid UTF-8 byte sequence: ' + (err && err.message ? err.message : String(err)));
  }
}

function readJsonStrict(path) {
  const abs = resolve(path);
  const buf = readFileSync(abs);
  const bomReason = detectBomReason(buf);
  if (bomReason) {
    return { ok: false, error: bomReason };
  }
  let text;
  try {
    text = decodeStrictUtf8(buf);
  } catch (err) {
    return { ok: false, error: err && err.message ? err.message : String(err) };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (err) {
    return {
      ok: false,
      error: 'JSON parse failed: ' + (err && err.message ? err.message : String(err)),
    };
  }
}

function validateOne(path) {
  const tag = basename(path);
  const got = readJsonStrict(path);
  if (!got.ok) {
    return { tag, status: 'FAIL', reason: got.error };
  }
  const r = AutomationRequestSchema.safeParse(got.value);
  if (!r.success) {
    const issue = r.error.issues[0];
    const where = issue && Array.isArray(issue.path) ? issue.path.join('.') : '<root>';
    const msg = issue && issue.message ? issue.message : 'invalid envelope';
    return { tag, status: 'FAIL', reason: 'schema: ' + where + ': ' + msg };
  }
  return { tag, status: 'PASS', reason: 'envelope parsed and schema-valid' };
}

function writeLine(stream, line) {
  stream.write(line + '\n');
}

function main(argv) {
  const inputs = argv.slice(2);
  if (inputs.length === 0) {
    writeLine(
      process.stderr,
      'usage: node scripts/validate-n8n-envelopes.mjs <envelope.json> [<envelope.json> ...]',
    );
    writeLine(
      process.stderr,
      'expected 7 envelope exports from n8n (per T0 R2 directive);',
    );
    writeLine(
      process.stderr,
      'the script accepts any number >= 1 and reports PASS / FAIL for each.',
    );
    process.exit(2);
  }

  let failed = 0;
  for (const path of inputs) {
    const r = validateOne(path);
    const line = r.status + '  ' + r.tag + '  -- ' + r.reason;
    if (r.status === 'PASS') {
      writeLine(process.stdout, line);
    } else {
      writeLine(process.stderr, line);
      failed += 1;
    }
  }

  const summary =
    'summary: ' +
    (inputs.length - failed) +
    '/' +
    inputs.length +
    ' PASS, ' +
    failed +
    '/' +
    inputs.length +
    ' FAIL';
  if (failed === 0) {
    writeLine(process.stdout, summary);
    process.exit(0);
  } else {
    writeLine(process.stderr, summary);
    process.exit(1);
  }
}

main(process.argv);
