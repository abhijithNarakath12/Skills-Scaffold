---
name: git-workflow
description: Day-to-day git for coding agents: branching, small focused commits with conventional messages, rebase vs merge per repo policy, resolving conflicts, non-interactive history editing, and gh CLI for pull requests. Includes hard safety rules (no force-push to shared branches, no rewriting published history, no committing secrets, no destructive commands without explicit instruction). Use whenever committing, branching, rebasing, resolving conflicts or opening PRs in a git repository.
---

# Git workflow

Assumes git 2.40+ and `gh` CLI 2.x. Interactive commands (`git rebase -i`, `git add -p`, editors) are unavailable to agents; every recipe below is non-interactive.

## When to use

- Creating branches, staging and committing, syncing with the remote, rebasing or merging.
- Resolving merge/rebase conflicts.
- Opening, updating and reviewing pull requests with `gh`.
- Recovering from mistakes (wrong branch, bad commit, lost work).

## Project conventions to detect first

1. Default branch and protection: `git remote show origin | grep 'HEAD branch'`, `gh repo view --json defaultBranchRef`, required checks/reviews (`gh api repos/{owner}/{repo}/branches/<main>/protection` if permitted).
2. Branch naming: look at `git branch -r | head -30` (`feat/...`, `fix/...`, `user/topic`, ticket IDs like `ABC-123-...`).
3. Commit message style: `git log --oneline -30`; Conventional Commits (`feat(scope): ...`), ticket prefixes, sign-off (`Signed-off-by`), GPG/SSH signing (`git config commit.gpgsign`). Tools: `commitlint.config.*`, `.commitlintrc`, `cz.json`, `.changeset/`, `CHANGELOG.md` conventions.
4. Integration policy: merge commits vs squash vs rebase (`gh repo view --json squashMergeAllowed,rebaseMergeAllowed,mergeCommitAllowed`), CONTRIBUTING.md, PR template `.github/PULL_REQUEST_TEMPLATE.md`.
5. Hooks and tooling: `.husky/`, `lefthook.yml`, `.pre-commit-config.yaml`; run them rather than bypassing with `--no-verify`.
6. Monorepo conventions: scoped commits, CODEOWNERS, changesets per package.
7. `.gitignore` / `.gitattributes`: LFS patterns, line endings (`* text=auto`), generated files that must stay untracked.

## Core guidance

### Safety rules

- Never `git push --force` or `--force-with-lease` to `main`/`master`/`develop`/release branches or any branch someone else may have checked out, unless the user explicitly instructs it for that branch. On your own feature branch after a rebase, use `git push --force-with-lease`.
- Never rewrite published history (`rebase`, `commit --amend`, `reset`) on commits that exist on a shared remote branch without explicit instruction.
- Never run `git reset --hard`, `git checkout -- .`, `git clean -fd`, `git branch -D`, `git stash drop/clear`, or `git push --delete` without first confirming what will be lost (`git status`, `git stash list`, `git log`) and telling the user; prefer `git stash push -u` to preserve work.
- Never commit secrets: `.env*` (except `.env.example`), keys, tokens, `credentials.json`, kubeconfigs, `*.pem`. Check `git diff --cached` before committing; if a secret was committed, tell the user immediately, rotate it, and remove it from history only with explicit instruction (`git filter-repo`).
- Never skip hooks (`--no-verify`) or sign-off requirements unless asked.
- Do not change git config (`user.name`, `user.email`, signing) unless asked.
- Only commit and push when the user asks or the task clearly requires it; if on the default branch, create a branch first.

### Branching

```bash
git fetch origin --prune
git switch -c feat/orders-pagination origin/main     # branch from fresh main
git switch -                                        # back to previous branch
git branch --show-current
```

- One branch per task; short-lived. Name per repo convention; include the ticket ID if the repo does.
- Keep the branch up to date with `git fetch` + `git rebase origin/main` (if the repo rebases) or `git merge origin/main` (if it merges). Do not mix styles within one PR unless policy allows.

### Commits

```bash
git status --short
git add src/orders/ tests/orders/                   # stage specific paths, not -A blindly
git diff --cached --stat                            # review what is staged
git commit -m "feat(orders): add keyset pagination to list endpoint" -m "Replaces OFFSET pagination; see ADR-012."
```

- Small, single-purpose commits; separate refactors from behaviour changes, formatting from logic.
- Message: imperative mood, <= 72-char subject, blank line, body explaining why (not what). Conventional Commits types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`, `build`, `ci`; `!` or `BREAKING CHANGE:` footer for breaking changes.
- Reference issues in the footer (`Closes #123`) if the repo does.
- `git add -N <file>` + `git diff` to review new files; `git add -p` is interactive and unavailable, so split changes by file or make the edit in two steps.
- Amend only the latest unpushed commit: `git commit --amend --no-edit`.

### Syncing and rebasing (non-interactive)

```bash
git fetch origin
git rebase origin/main                               # replay branch on main
git rebase --continue | --skip | --abort             # after resolving conflicts
git push --force-with-lease origin feat/orders-pagination   # own branch only
```

- Squash a branch into one commit without `-i`: `git reset --soft $(git merge-base origin/main HEAD) && git commit -m "..."`.
- Edit an older commit message or reorder: use `GIT_SEQUENCE_EDITOR` with a script, e.g. `GIT_SEQUENCE_EDITOR="sed -i.bak 's/^pick abc1234/reword abc1234/'" git rebase -i origin/main` combined with `GIT_EDITOR` set to a script that writes the message; or prefer `git commit --fixup=<sha>` followed by `GIT_SEQUENCE_EDITOR=: git rebase -i --autosquash origin/main`.
- `git rebase --update-refs` when stacking branches; `git rerere` (`git config rerere.enabled true`) to replay conflict resolutions.
- Use `git pull --rebase` only if the repo policy is rebase; otherwise `git pull --ff-only` and resolve divergence deliberately.

### Resolving conflicts

```bash
git status                                  # "both modified" files
git diff --name-only --diff-filter=U
git checkout --conflict=diff3 <file>        # show base too
# edit: remove <<<<<<< ======= >>>>>>> markers, keep the correct combination
git add <file>
git rebase --continue   # or git merge --continue / git commit
```

- Read both sides and the base (`diff3`); do not pick "ours"/"theirs" wholesale unless certain (`git checkout --ours|--theirs <file>` then re-check). During rebase, "ours" is the upstream and "theirs" is your commit.
- Lockfile conflicts: take the base/main version and re-run the package manager (`npm install`, `pnpm install`, `poetry lock --no-update`) to regenerate.
- Generated files/snapshots: regenerate rather than hand-merge.
- After resolving, run the build/tests before continuing; `grep -rn '<<<<<<<\|>>>>>>>' .` to catch leftovers.

### Pull requests with gh

```bash
git push -u origin feat/orders-pagination
gh pr create --fill --base main --title "feat(orders): keyset pagination" --body-file .github/PULL_REQUEST_TEMPLATE.md
gh pr create --draft ...                              # WIP
gh pr view --web
gh pr checks --watch
gh pr diff
gh pr comment <n> --body "..."
gh pr review <n> --approve | --request-changes --body "..."
gh pr merge <n> --squash --delete-branch             # per repo policy; only when asked
gh pr status ; gh pr list --author @me
```

- PR body: what and why, how to test, screenshots for UI, linked issue. Follow the template.
- Write `@user` only for real logins you intend to notify; put placeholders and package names in backticks.
- Address review comments with new commits (or fixups squashed before merge if the repo prefers clean history); push and reply.

### Inspecting history

```bash
git log --oneline --graph --decorate -20
git log -p --follow -- path/to/file
git blame -L 10,30 path/to/file ; git log -S 'functionName' --oneline
git show <sha> --stat
git diff origin/main...HEAD                           # what the PR changes
git bisect start ; git bisect bad ; git bisect good <sha> ; git bisect run npm test ; git bisect reset
```

## Common tasks

### Start a change

1. `git status` must be clean (or stash with `git stash push -u -m "wip"`).
2. `git fetch origin && git switch -c <type>/<topic> origin/<default>`.
3. Make changes; run tests; commit in logical units.

### Update a PR after main moved

1. `git fetch origin`; rebase or merge per policy; resolve conflicts; run tests.
2. `git push --force-with-lease` (rebase) or `git push` (merge).
3. `gh pr checks --watch`.

### Undo safely

```bash
git restore --staged <file>            # unstage
git restore <file>                     # discard unstaged changes to one file (confirm first)
git revert <sha>                       # undo a pushed commit with a new commit
git reset --soft HEAD~1                # uncommit, keep changes staged (unpushed only)
git reflog                             # find lost commits; git switch -c rescue <sha>
git stash list ; git stash show -p stash@{0} ; git stash pop
```

### Move work to the right branch

```bash
git stash push -u -m "move"            # or commit on wrong branch, then:
git switch -c feat/correct origin/main
git stash pop                          # or git cherry-pick <sha> and remove from the wrong branch with explicit instruction
```

### Handle a secret committed by mistake

1. Stop; tell the user which file/commit. Do not push if it is only local: `git reset --soft HEAD~1`, remove the secret, add the path to `.gitignore`, recommit.
2. If already pushed: the secret is compromised; the user must rotate it. History rewrite (`git filter-repo --path <file> --invert-paths`) only with explicit instruction and coordination, since it requires force-pushing shared history.
3. Add a secret scanner (`gitleaks`, `trufflehog`, GitHub secret scanning) if the repo lacks one.

### Add or fix `.gitignore`

- Generate a base from https://github.com/github/gitignore for the stack; add `.env*`, `!.env.example`, IDE folders, build output, coverage. Untrack already-committed files with `git rm --cached <path>` (keeps the file on disk).

## Pitfalls

- `git add -A`/`git add .` sweeping in build output, `.env`, or debugging files; stage paths explicitly and review `git diff --cached`.
- Committing on `main` directly; create a branch first.
- `git pull` creating surprise merge commits in a rebase-policy repo (`pull.rebase` or `--ff-only`).
- Force-pushing after someone else pushed to the same branch; `--force-with-lease` refuses if the remote moved, `--force` destroys their work.
- Resolving conflicts by taking one side entirely and silently dropping the other side's change.
- Leaving conflict markers in files; grep for them before committing.
- `--no-verify` to get past failing hooks instead of fixing the problem.
- Large binaries committed without LFS, bloating the repo forever.
- Amending or rebasing commits that are already in an open PR others have reviewed, without telling them.
- `git stash` without `-u` loses nothing but leaves untracked files behind; `git stash drop` after a failed `pop` loses work (the stash is still in `git fsck --unreachable` for a while).
- Wrong author identity in commits when `user.email` is unset in a fresh environment; check `git config user.email` (do not change it without asking).

## Verification

```bash
git status --short                      # only intended files changed
git diff --cached                       # staged diff is exactly the change; no secrets, no debug output
git log --oneline origin/main..HEAD     # commits are small and well described
npm test / pytest / go test / make test # tests pass on the final commit
gh pr checks                            # CI green on the PR
grep -rn '<<<<<<<\|>>>>>>>' --exclude-dir=node_modules --exclude-dir=.git . || true   # no conflict markers
```

## References

- Pro Git book: https://git-scm.com/book/en/v2
- git reference: https://git-scm.com/docs
- Conventional Commits: https://www.conventionalcommits.org/en/v1.0.0/
- gh CLI manual: https://cli.github.com/manual/
- GitHub flow: https://docs.github.com/en/get-started/using-github/github-flow
- git-filter-repo: https://github.com/newren/git-filter-repo
- gitleaks: https://github.com/gitleaks/gitleaks
