# ARTIFACT VERIFICATION

## Accepted artifact (bilaterally accepted)

- Filename: `hrp-engagement-contracts-0.0.0-r2-candidate.0.tgz`
- Byte size: 169360
- File count: 79
- SHA-256: `b1db1cb28aeab10bb85497661e1d976dc7370c9abb280db9a3aff16567732dfc`
- npm shasum: `4713b1ce639acdc070a9fa95f868bc08b99d0f9b`
- Source commit: `1841c9354f361c4ac2bdb70a325c739c264262de`

## Reconstruction

The artifact was reconstructed by CONTRACT-03C.1 tooling at
`df73b2098a5058f31186981209f4eacd5edac9d8` via:

```
node tools/reconstruct.mjs \
  --descriptor reconciliation/crm/CONTRACT-03C/artifact-pinning/r1/ARTIFACT-DESCRIPTOR.json \
  --output-dir reconciliation/crm/CONTRACT-03C/artifact-pinning/r1/builds/build-3
```

The `build-3` reconstruction produced a tarball whose
`RECONSTRUCT-RESULT.txt` records:

```
filename=hrp-engagement-contracts-0.0.0-r2-candidate.0.tgz
byte_size=169360
sha256=b1db1cb28aeab10bb85497661e1d976dc7370c9abb280db9a3aff16567732dfc
npm_shasum=4713b1ce639acdc070a9fa95f868bc08b99d0f9b
file_count=79
source_commit=1841c9354f361c4ac2bdb70a325c739c264262de
matched_descriptor=true
```

## Per-byte verification (re-run)

Independently re-verified during the CONTRACT-03C.2 handoff:

```
$ node -e "var c=require('crypto'),fs=require('fs');
var b=fs.readFileSync('hrp-engagement-contracts-0.0.0-r2-candidate.0.tgz');
console.log('sha256='+c.createHash('sha256').update(b).digest('hex'));
console.log('size='+b.length);"

sha256=b1db1cb28aeab10bb85497661e1d976dc7370c9abb280db9a3aff16567732dfc
size=169360
```

Result: SHA-256 MATCHES, size MATCHES, file count MATCHES, npm shasum
MATCHES.

## Reproducibility

A second independent reconstruction (`build-1 v3`) was performed during
CONTRACT-03C.1 review and produced the identical SHA-256. See
`reconciliation/crm/CONTRACT-03C/artifact-pinning/r1/DOUBLE-BUILD-EVIDENCE.md`
in the neutral repo at `df73b2098a5058f31186981209f4eacd5edac9d8`.

A third reproduction is recorded by the build-3 result above. All three
runs converge to the same SHA-256 — drift would have been blocked by
`verify-artifact.mjs` exit 1.

## Outcome

ARTIFACT IDENTITY CONFIRMED. The CRM worktree proceeded to install and
test only AFTER this verification succeeded.

No `.tgz` was committed to the CRM repository. No Git tag was created.
No npm publish was performed. No absolute workstation path is recorded
in `package.json`, `package-lock.json`, or any consumer `package.json`.
