# R6 QA — verification checklist

Executed locally: `npm run check`, `npm run acceptance:r6`, `node --check public/app.js`. These validate Node/SQLite behavior and UI syntax. CI in GitHub is the source of truth for Next.js build and PostgreSQL RLS, not local test output.

Coverage includes:
- AES-256-GCM ciphertext remains encrypted and binds evidence ID/hash/length
- Canonical base64, MIME sniffing, unsupported files and size limits
- Admin HMAC scan attestation, replay rejection and scanner misconfiguration
- No client or internal download before independent scan
- Clear/submit/current-link/accept/verified-receipt end-to-end
- Multi-tenant roles, origin/CSRF, wrong-org token, revoked share
- Revocation blocks existing attachments without rewriting audit
- Tampered ciphertext and symlinks fail closed
- Accepted receipt detects modification, revision changes hide previous attachments
- Admin quarantine and verification routes reject non-admin users
- Quota 15 files per milestone and signed data excluded from database columns

Do not claim successful external malware scanning, PostgreSQL production writes, real settlement, or live deployment. They are not part of this pass.
