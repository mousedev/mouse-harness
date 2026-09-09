Committed copy of the run: report, candidate/run records, checkpoint manifest, per-trial records,
agent trajectories/logs, driver logs, stub verification, and SUBMISSION.md. Token-shaped strings in
the committed trajectories are redacted (`*_REDACTED`) because several benchmark tasks plant fake
credentials and GitHub push protection rejects them; the evidence tarball
`fh-run-2026-09-08-mouse-c-full.tar.gz` (sha256 in SUBMISSION.md) holds the unmodified Harbor/Pier
job directories, verifier output, and retained attempts.
