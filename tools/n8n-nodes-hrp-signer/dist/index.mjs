// index.mjs
// Public re-exports of the package's three capabilities.

export {
  canonicalJson,
  sha256Hex,
  payloadDigestHex,
  signLegacy,
  stripNonDigestFields,
  scopeKeyFor,
  composeSigningInput,
  buildHeadersAndSignature,
} from './signer.mjs';

export {
  assertHrpAutomationLegacyCredentialFields,
  HrpAutomationLegacySignatureCredential,
} from './credential.mjs';

export {
  findCredential,
  execute as executeHrpAutomationSigner,
  HrpAutomationSigner,
} from './node.mjs';