Committed copy of the run: report, candidate/run records, checkpoint manifest, per-trial records,
agent trajectories/logs, driver logs, stub verification, and SUBMISSION.md. Prefix-shaped tokens in
the committed trajectories (`AKIA...`, `ghp_...`, `hf_...`) are redacted to `*_REDACTED` because
several benchmark tasks plant fake credentials and GitHub push protection rejects them; the
planted AWS secret in the sanitize-git-repo task and the PEM headers from openssl-selfsigned-cert
have no such prefix and are left as the tasks wrote them; the evidence tarball
`fh-run-2026-09-08-mouse-c-full.tar.gz` (sha256 in SUBMISSION.md) holds the unmodified Harbor/Pier
job directories, verifier output, and retained attempts.
