# auto-apply

## Workflow

- **Start**: if the checkout already has work in progress (uncommitted changes, or a branch someone else is using), do the work in a git worktree instead: `git worktree add ../auto-apply-<feature> -b <feature>`, then `bun install` there.
- **Pre-commit**: `.githooks/pre-commit` runs `bun run check` (typecheck, lint, format check, tests) on every commit. Fix what it flags; don't use `--no-verify`.
- **Commit regularly**: small commits, one per working step.
- **Finish**: when the feature is done, squash its commits into one and merge it into `master`. If `master` has moved on since you branched, rebase onto it, run `bun run check` again, and fast-forward `master`. Open a PR instead only when the `master` checkout has significant uncommitted work. Then delete the worktree and branch: `git worktree remove ../auto-apply-<feature>` and `git branch -d <feature>`.
