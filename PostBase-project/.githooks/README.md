# Repository hooks

The pre-push gate refuses a push to `master` until the fast checks pass
(`typecheck`, `lint:ci`, `gates:drift`); `PUSH_GATE=full` adds the whole
coverage suite, and `git push --no-verify` bypasses one push on purpose.

Install it — one command, from anywhere in the clone:

```sh
git config core.hooksPath PostBase-project/.githooks
```

The setting is local to the clone (it is not committed), so each clone runs
it once. Without it the hook never fires and only GitHub's ruleset stands
between a red tree and `master`.
