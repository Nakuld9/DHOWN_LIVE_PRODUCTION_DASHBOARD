# Local Push CI

A local, self-hosted CI that runs the full backend gate on every push — **entirely
on this machine, nothing leaves the box** (honors the "never push to GitHub" rule).
It is the independent, post-push checkpoint that complements the blocking pre-commit gate.

## How it works

- A **bare git repo** acts as the CI remote: `D:\DHOWN_CI\dhown_mes.git`
- It is wired into the main repo as the remote **`ci`**.
- A **`post-receive` hook** (in `D:\DHOWN_CI\dhown_mes.git\hooks\post-receive`) fires on
  every push to `main`:
  1. Checks the pushed commit out into an isolated work tree (`D:\DHOWN_CI\work`).
  2. Reuses the main checkout's `backend\node_modules` (a junction — no reinstall) and
     copies `backend\.env` (DB creds; never in git).
  3. Runs `npm run check` — the full gate (171 unit + 38 e2e).
  4. Logs to `D:\DHOWN_CI\runs\ci_<timestamp>_<sha>.log` and appends a one-line
     PASS/FAIL to `D:\DHOWN_CI\runs\history.txt`.
  5. Reports `CI: PASS` / `CI: FAIL` back to the pusher. (post-receive runs after the
     push is accepted, so a FAIL reports but does not un-receive — the pre-commit gate
     is the blocking layer.)

Only the DHOWN git repo has CI. VD Knits is a non-git mirror tree (files copied), so it
has no separate remote.

## Use

```bash
# after committing on main, run the gate on the pushed code:
git push ci main
```

Watch the `remote: CI:` lines for the result, or check history:

```bash
cat /d/DHOWN_CI/runs/history.txt
```

## Notes

- First push junctions `node_modules`; later pushes reuse it, so a run is just the gate
  (~3–4 min). If a push introduces a new dependency, run `npm install` in the main
  checkout first (as you would anyway) — the junction picks it up.
- The e2e suites hit the live server on `localhost:4000` + the DB, exactly as the
  pre-commit gate does; keep the DHOWN service up when pushing.
- **Optional upgrade:** if a web UI / pull-request review / multi-user access is ever
  wanted, this can be promoted to a self-hosted **Gitea** instance (built-in Actions) on
  the same box — still local, nothing leaving the machine. Not needed for the current
  single-dev workflow.
