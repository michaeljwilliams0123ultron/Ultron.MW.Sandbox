# Sandbox live-autonomy acceptance (experimental branch)

This branch intentionally retains a **Sandbox-only** GitHub Actions live-mutation workflow for repeatable testing. It must not be promoted to the primary Ultron.MW repository, which has an eight-workflow consolidation invariant.

- Sandbox: `michaeljwilliams0123ultron/Ultron.MW.Sandbox`
- Tested source SHA: `57bb9ec0c2bec90acac7911e518a7e7ba28df118`
- Successful live run: https://github.com/michaeljwilliams0123ultron/Ultron.MW.Sandbox/actions/runs/43158596502
- Independent GitHub evidence: `canary/autonomy-write-43158596502/evidence/live-autonomy/43158596502.json`
- Verified: 11 unit tests, one remote mutation, post-commit lost-ack reconciliation, readback, replay without a second write, $0 paid inference.
- Production: no changes or release accepted by this Sandbox evidence.

The normal release PR should carry the two executable files (`scripts/sandbox-live-autonomy.mjs`, `test/sandbox-live-autonomy.test.mjs`) but **not** this ninth experimental workflow. Subsequent production canaries must follow the existing owner-controlled, signed, scoped authorization gates.
