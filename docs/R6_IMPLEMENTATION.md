# R6 Implementation — Evidence Vault / Delivery Integrity

## 1. API / contract

Bearer session, same-origin and CSRF apply to authenticated writes. Every API response is `Cache-Control: no-store`, errors are consistent `HttpError` JSON.

| Method | Endpoint | Who | Function |
|---|---|---|---|
| POST | `/api/projects/:projectId/milestones/:milestoneId/evidence` | owner/editor | JSON `{fileName,mime,contentBase64}`, max 2 MiB, encrypted quarantine |
| GET | `/api/projects/:projectId/milestones/:milestoneId/evidence` | member | list metadata and scan status only |
| GET | `/api/projects/:projectId/evidence/:id` | member | ciphertext verified, available only if cleared |
| POST | `/api/projects/:projectId/evidence/:id` | owner/editor | revoke access with `{reason}`; append audit event |
| GET | `/api/admin/evidence/quarantine` | admin | scanner work queue, metadata only |
| GET | `/api/admin/evidence/integrity` | admin | check every encrypted object against its DB hash |
| POST | `/api/admin/evidence/:id/scan` | admin | scanner attestation `{verdict,engine,attestation}` |
| POST | `/api/projects/:p/milestones/:m/submit` | owner/editor | bind `evidenceIds: string[]` to immutable submission revision |
| GET | `/api/projects/:p/milestones/:m/receipt` | member | verified receipt JSON |
| GET | `/api/public/projects/:token/evidence/:id` | current link holder | download ONLY if linked to latest submitted or accepted stage and cleared |
| GET | `/api/public/projects/:token/milestones/:m/receipt` | current link holder | accepted stage only, hash verified |

For public downloads, the response is an attachment with `nosniff`, `private, no-store`, `same-origin` policy and no token leaks in any log or filename. Per-IP and per-user rate limits are in the Node server (local memory; production deployment requires shared rate-limit storage).

## 2. Vault and scanner requirements

`EVIDENCE_ENCRYPTION_KEY` is exactly 32 random bytes encoded as 64 lowercase hexadecimal characters. Do not reuse the payment webhook key. `EVIDENCE_SCANNER_SECRET` must be at least 32 characters and **must not** be distributed to browsers or front-end code. `EVIDENCE_DIR` must be a private directory outside the web root with restricted OS permissions.

Files are encrypted with random 12-byte nonce and AES-256-GCM tag. GCM AAD binds UUID, SHA-256 and byte length; open uses `O_NOFOLLOW` and checks regular-file metadata. Only an attested `clean` verdict may change `quarantined → cleared`. A signed `infected` verdict changes `quarantined → rejected`; a suspected incident may also change a cleared object to `revoked` without deleting its audit trail.

**No real malware scanner is bundled.** An external scanner must read the quarantined file under controlled privileges, compute the SHA-256 of the decrypted content, and sign the tuple `id|digest|verdict|engine` using HMAC-SHA256. The operator submits that attestation through the admin-only endpoint. Manual signing without scan is prohibited by operating policy. Configure alerting for failed scans and unavailable scanner.

## 3. Delivery proof

`work_submission_evidence` is the binding of evidence IDs to a specific revision of the milestone. When the client requests changes, evidence from an older revision is not automatically in the new revision. Receipt JSON includes project, milestone, revision, SHA-256 of submitted summary and a sorted manifest of verified attachment hashes. Verification recalculates the digest and manifest. A receipt does **not** certify legal identity of the link holder.

## 4. PostgreSQL and operational isolation

Apply `008_evidence_vault.sql` AFTER `006_workflow.sql`. CI tests `009_evidence_rls_smoke.sql` on disposable PostgreSQL, checking tenant separation and refusing SELECT on token-hash table. The R6 prototype's active runtime still uses SQLite, **not PostgreSQL runtime**. Staging with PostgreSQL writes is a separate milestone.

## 5. Threat model and limitations

- Prevented: forged MIME, oversized uploads, forged scanner signatures, cross-org reads and writes, stale/revoked links, corrupt GCM and symlink ciphertext, browser inline execution on download, double responses, detached historical evidence.
- Pending: external malware scanner, centralized limits on multiple instances, S3/KMS-backed encrypted storage and key rotation, file deletion/privacy retention, signed-in reviewer identity, high-availability staging, real billing.
- Backups must include **both** the database and encrypted vault directory; a database-only restore is insufficient for R6 evidence.
