# AUTHORITY AND LINEAGE

## Authoritative commits

| Role | Commit | Notes |
|---|---|---|
| Bilateral packaging/compatibility acceptance | `1841c9354f361c4ac2bdb70a325c739c264262de` | MSG-045 acceptance commit; packages/publish-candidate frozen input. |
| CONTRACT-03C.1 accepted tooling closure | `df73b2098a5058f31186981209f4eacd5edac9d8` | Local immutable artifact pinning closure. |
| CONTRACT-03C.2 r2 active migration plan | `89e73c3b2b29fdcbc18eee76ca29c256629eea50` | r2 plan referenced throughout this contract. |
| CONTRACT-03C.2 r1, audit history only | `691f6630cb0bde0cdb70e0c315473ae23215a197` | Not used as source-of-truth. |
| CRM baseline (pinned) | `72643356a0d1355f9dccc3921b47c990ea9c31c1` | `fix: make V7.9a clean build and concurrent receipt handling reproducible` |

All values verified to exist by `git rev-parse` from a clean clone of
each repository.

## Plan authority

The r2 plan at `89e73c3b2b29fdcbc18eee76ca29c256629eea50` is the only
contract authority for this slice. The r1 plan at
`691f6630cb0bde0cdb70e0c315473ae23215a197` is preserved as audit
history. No planning document has been rewritten by this contract.

## Artifact authority

The artifact identity is pinned at:

- Filename: `hrp-engagement-contracts-0.0.0-r2-candidate.0.tgz`
- Expected size: 169360 bytes
- Expected file count: 79
- Expected SHA-256: `b1db1cb28aeab10bb85497661e1d976dc7370c9abb280db9a3aff16567732dfc`
- Expected npm shasum: `4713b1ce639acdc070a9fa95f868bc08b99d0f9b`
- Publication status: `NOT_EXECUTED`

## CRM branch / SHA

- Branch: `codex/contract03c2-consumer-adoption-r1`
- Implementation SHA: see `git log -1 codex/contract03c2-consumer-adoption-r1`
- Worktree path (isolated): `D:\CodeApp\Hrp-Crm-03c2-r2` (Windows path on the
  T1-B workstation; the worktree is on the branch above; git status is
  recorded in `WORKTREE-STATE.txt`).

## Workspace state on entry

- git rev-parse HEAD: `72643356a0d1355f9dccc3921b47c990ea9c31c1`
- git status --short: see `WORKTREE-STATE.txt`
- remote URL: see `WORKTREE-STATE.txt`
- Node: see `WORKTREE-STATE.txt`
- npm: see `WORKTREE-STATE.txt`
- absence/presence of dist and node_modules: see `WORKTREE-STATE.txt`

## Subpath authority

The adopted subpath is `@hrp-engagement/contracts/talent-context-read/v1`.
Its content is the bilaterally accepted source at
`1841c9354f361c4ac2bdb70a325c739c264262de`, NOT local re-derivation.

## FINAL-IMPLEMENTATION-SHA

Recorded by `git log -1 codex/contract03c2-consumer-adoption-r1`. The
authoritative HEAD SHA is the one currently checked out on the
implementation branch and is verifiable on the remote immediately
after push.
