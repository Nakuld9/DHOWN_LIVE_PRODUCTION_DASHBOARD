# Git hooks

`core.hooksPath` is **local git config, not part of the repository** — a fresh
clone will not run these until it is pointed at this directory:

```bash
git config core.hooksPath .githooks
```

`npm run hooks:install` in `backend/` does the same thing.

## Why a hook rather than hosted CI

This repository is never pushed; commits stay local by decision. A GitHub Actions
workflow would be a file that never runs. The commit is therefore the only moment
a regression can be caught automatically, so that is where the gate lives.

## pre-commit

Runs only when something under `backend/` is staged.

| Tier | What | On failure |
|------|------|-----------|
| `backend/test` | Unit tests, no database, ~3s | **Blocks the commit** |
| `backend/tests` | End-to-end against a real database | Blocks — but **skipped entirely** if Postgres is unreachable |

The end-to-end tier is skipped rather than failed when Postgres is down. Blocking
a commit because a database happens to be stopped trains people to reach for
`--no-verify`, which costs more than the tests are worth.

Bypass deliberately when you mean to:

```bash
git commit --no-verify
```

Verified to actually block: breaking the margin formula so it measured against
cost instead of selling price failed 3 unit tests and aborted the commit.
