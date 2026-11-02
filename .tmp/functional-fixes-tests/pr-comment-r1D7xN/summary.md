
## Probe comment — ⚠️ the comment was redacted before posting

The 'Write the probe' step's body needed 1 substitution
before it could go up: a name that looks like a secret, a URL carrying credentials, or a
private key written out. Each was replaced with `<redacted>`, and the comment was posted
with the substitutions in place — the run's artifact keeps the body as it was written.

What was replaced is recorded in `proposal.redactions.json`, beside that body in the run's artifact, so
the posted comment and the artifact can be compared substitution by substitution.

## Probe comment — ⚠️ the body carries a run that may be a secret

The 'Write the probe' step's body carries 1 run long and mixed
enough to be a generated key, and no rule here claims its shape — so
it was **not** redacted, and the comment is carrying it.

The rules hide what they are sure of; a shape they cannot be sure of is shown to a person
instead, because hiding a word that was never a secret costs more than it saves. Check each
one, and rotate anything that should not have been published.

- `sklive9Xk2Qp7Zr4Tn8Vw1YsAbb12`
