import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,existsSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../src/db.mjs';
import {createServices} from '../src/services.mjs';
import {createEncryptedBackup,restoreEncryptedBackup} from '../src/ops-encrypted.mjs';
import {releaseGate} from '../scripts/r4-release-gate.mjs';
import {runLoadSmoke} from '../scripts/r4-load-smoke.mjs';
function fixture(){const dir=mkdtempSync(join(tmpdir(),'osx-r4-encrypted-'));const db=openDatabase(':memory:');const svc=createServices(db);
 const user=svc.createUser({name:'R4 Backup',email:'backup@example.test',password:'long-correct-password-123'});
 svc.createQuote(user.user.id,user.orgId,{title:'Client order',clientName:'Customer',items:[{description:'Web work',qty:2,unitPriceCents:12000,unitCostCents:6000}]});
 return {dir,db,svc,key:randomBytes(32),close:()=>{db.close();rmSync(dir,{recursive:true,force:true})}};
}
test('R4 OPS 01: AES-GCM backup round-trips through verified new database',async()=>{
 const f=fixture();try{const out=join(f.dir,'snapshot.enc'),restored=join(f.dir,'recovered.sqlite');
  const result=await createEncryptedBackup(f.db,out,f.key);assert.equal(result.encrypted,true);assert.equal(result.offsiteUploaded,false);
  assert.ok(readFileSync(out).subarray(0,12).toString()==='OSXBACKUPR4!');
  assert.ok(!readFileSync(out).includes(Buffer.from('backup@example.test')));
  const report=restoreEncryptedBackup(out,restored,f.key);assert.equal(report.verified,true);
  const other=openDatabase(restored);try{assert.equal(other.prepare('SELECT COUNT(*) n FROM quotes').get().n,1);assert.equal(createServices(other).verifyAudit().lastHash,f.svc.verifyAudit().lastHash)}finally{other.close()}
 }finally{f.close()}
});
test('R4 OPS 02: wrong key cannot decrypt and leaves no partial database',async()=>{
 const f=fixture();try{const src=join(f.dir,'backup.enc'),dest=join(f.dir,'restored.sqlite');await createEncryptedBackup(f.db,src,f.key);
 assert.throws(()=>restoreEncryptedBackup(src,dest,randomBytes(32)),/authentication failed/);
 assert.equal(existsSync(dest),false);assert.equal(existsSync(dest+'.partial'),false);
 }finally{f.close()}
});
test('R4 OPS 03: ciphertext corruption fails before decrypt',async()=>{
 const f=fixture();try{const src=join(f.dir,'backup.enc');await createEncryptedBackup(f.db,src,f.key);
 const raw=readFileSync(src);raw[raw.length-4]^=0x03;writeFileSync(src,raw);
 assert.throws(()=>restoreEncryptedBackup(src,join(f.dir,'output.sqlite'),f.key),/SHA-256 mismatch/);
 }finally{f.close()}
});
test('R4 OPS 04: altering authenticated metadata fails tag verification',async()=>{
 const f=fixture();try{const src=join(f.dir,'backup.enc');await createEncryptedBackup(f.db,src,f.key);
 const path=src+'.manifest.json',meta=JSON.parse(readFileSync(path,'utf8'));meta.auditHash='FAKE';writeFileSync(path,JSON.stringify(meta));
 assert.throws(()=>restoreEncryptedBackup(src,join(f.dir,'output.sqlite'),f.key),/authentication failed/);
 }finally{f.close()}
});
test('R4 OPS 05: cannot overwrite encrypted backup or restore destination',async()=>{
 const f=fixture();try{const src=join(f.dir,'backup.enc'),dest=join(f.dir,'output.sqlite');await createEncryptedBackup(f.db,src,f.key);
 await assert.rejects(()=>createEncryptedBackup(f.db,src,f.key),/destination exists/);
 restoreEncryptedBackup(src,dest,f.key);
 assert.throws(()=>restoreEncryptedBackup(src,dest,f.key),/destination exists/);
 }finally{f.close()}
});
test('R4 OPS 06: files are owner-readable only; no clear sqlite backup survives',async()=>{
 const f=fixture();try{const src=join(f.dir,'backup.enc');await createEncryptedBackup(f.db,src,f.key);
 assert.equal(statSync(src).mode&0o777,0o600);assert.equal(statSync(src+'.manifest.json').mode&0o777,0o600);
 assert.ok(!existsSync(join(f.dir,'clear.sqlite')));
 }finally{f.close()}
});
test('R4 OPS 07: staging gate fail-closed when evidence and secrets absent',()=>{
 const result=releaseGate({},{});assert.equal(result.eligible,false);
 assert.ok(result.errors.some(x=>x.includes('PostgreSQL')));assert.ok(result.errors.some(x=>x.includes('TLS')));
});
test('R4 OPS 08: staging gate enforces disabled payments even with positive evidence',()=>{
 const env={NODE_ENV:'production',APP_ORIGIN:'https://proof.example',IP_HASH_SECRET:'a'.repeat(40),METRICS_SECRET:'b'.repeat(40),PAYMENT_MODE:'stripe_test',BACKUP_ENCRYPTION_KEY:randomBytes(32).toString('base64'),OFFSITE_BACKUP_DESTINATION:'s3://test-bucket',TLS_TERMINATION_VERIFIED:'1'};
 const evidence={nodeTestsPassed:true,browserE2EPassed:true,postgresRlSVerified:true,backupRestoreVerified:true,securityReviewPassed:true};
 const report=releaseGate(env,evidence);assert.equal(report.eligible,false);assert.ok(report.errors.some(x=>x.includes('payments')));
});
test('R4 OPS 09: staging gate can evaluate complete externally supplied evidence (not attestation)',()=>{
 const env={NODE_ENV:'production',APP_ORIGIN:'https://proof.example',IP_HASH_SECRET:'a'.repeat(40),METRICS_SECRET:'b'.repeat(40),PAYMENT_MODE:'disabled',BACKUP_ENCRYPTION_KEY:randomBytes(32).toString('base64'),OFFSITE_BACKUP_DESTINATION:'s3://test-bucket',TLS_TERMINATION_VERIFIED:'1'};
 const evidence={nodeTestsPassed:true,browserE2EPassed:true,postgresRlSVerified:true,backupRestoreVerified:true,securityReviewPassed:true};
 const report=releaseGate(env,evidence);assert.equal(report.eligible,true);assert.equal(report.realPaymentsEnabled,false);
});
test('R4 OPS 10: controlled load test validates rate limiting and integrity after concurrency',async()=>{
 const result=await runLoadSmoke({concurrency:40});assert.equal(result.ok,true);assert.equal(result.health200,40);
 assert.ok(result.blockedLogin429>0);assert.equal(result.ledgerOk,true);assert.equal(result.auditOk,true);
});
