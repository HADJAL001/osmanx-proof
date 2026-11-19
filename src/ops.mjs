import { DatabaseSync, backup } from 'node:sqlite';
import { mkdirSync, existsSync, copyFileSync, readFileSync, writeFileSync, renameSync, rmSync, statSync, constants } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { createServices } from './services.mjs';

const fingerprint=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
function checkSnapshot(path){
 const file=resolve(path);
 if(!existsSync(file)||!statSync(file).isFile())throw Error('Snapshot missing');
 const db=new DatabaseSync(file,{readOnly:true});
 try{
  const quick=db.prepare('PRAGMA integrity_check').get()?.integrity_check;
  const keys=db.prepare('PRAGMA foreign_key_check').all();
  const svc=createServices(db);
  const audit=svc.verifyAudit(),ledger=svc.verifyLedger();
  const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x=>x.name);
  const ok=quick==='ok'&&keys.length===0&&audit.ok&&ledger.ok;
  return {ok,integrity:quick,foreignKeyIssues:keys.length,audit,ledger,tableCount:tables.length,bytes:statSync(file).size,sha256:fingerprint(file)};
 } finally {db.close();}
}
export function verifyBackup(path,{requireManifest=true}={}){
 const file=resolve(path),report=checkSnapshot(file);
 const manifestFile=file+'.manifest.json';
 if(requireManifest){
  if(!existsSync(manifestFile))throw Error('Backup manifest missing');
  const m=JSON.parse(readFileSync(manifestFile,'utf8'));
  if(m.format!=='OSMANX_PROOF_SQLITE_BACKUP_V1'||m.sha256!==report.sha256)throw Error('Backup SHA-256 mismatch');
  report.manifest=m;
 }
 if(!report.ok)throw Error(`Backup integrity verification failed: ${JSON.stringify(report)}`);
 return report;
}
export async function makeBackup(db,outputPath){
 const file=resolve(outputPath),tmp=file+'.partial';
 if(existsSync(file)||existsSync(file+'.manifest.json'))throw Error('Destination exists; backups never overwrite');
 mkdirSync(dirname(file),{recursive:true});
 if(existsSync(tmp))throw Error('Unfinished backup file exists; inspect it before proceeding');
 try{
  await backup(db,tmp);
  const check=checkSnapshot(tmp);
  if(!check.ok)throw Error('Backup failed consistency checks');
  renameSync(tmp,file);
  const manifest={format:'OSMANX_PROOF_SQLITE_BACKUP_V1',createdAt:new Date().toISOString(),sha256:check.sha256,bytes:check.bytes,auditHash:check.audit.lastHash,ledgerTransactions:check.ledger.transactions,encrypted:false};
  writeFileSync(file+'.manifest.json',JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
  return verifyBackup(file);
 }catch(e){if(existsSync(tmp))rmSync(tmp);throw e;}
}
export function restoreBackup(source,target){
 const report=verifyBackup(source),dest=resolve(target);
 if(existsSync(dest)||existsSync(dest+'-wal')||existsSync(dest+'-shm'))throw Error('Restore destination exists; choose a new empty path');
 mkdirSync(dirname(dest),{recursive:true});
 copyFileSync(resolve(source),dest,constants.COPYFILE_EXCL);
 try{
  const verified=verifyBackup(dest,{requireManifest:false});
  if(verified.sha256!==report.sha256)throw Error('Restored file hash differs from backup');
  return {destination:dest,sha256:verified.sha256,verified:true,auditHash:verified.audit.lastHash};
 }catch(e){rmSync(dest,{force:true});throw e;}
}
