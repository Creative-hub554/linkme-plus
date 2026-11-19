
## Probe comment — ⚠️ the previous comment could not be looked up

The 'Write the probe' step could not list the comments on #7 (the lookup exited 1), so a new comment was posted rather than the one
the marker would have found. If a marked comment was already on #7, the pull
request now shows two of them.

The step stays green, and `gh`'s own message is in the log above. Delete the older
of the two, and the next run has one comment to update.
