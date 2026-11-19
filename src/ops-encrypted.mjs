// R4 authenticated offline backup package. No cloud credentials or offsite sync is included.
import {randomBytes,createCipheriv,createDecipheriv,createHash} from 'node:crypto';
import {readFileSync,writeFileSync,renameSync,existsSync,rmSync,mkdtempSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,dirname,join} from 'node:path';
import {makeBackup,verifyBackup} from './ops.mjs';
const MAGIC=Buffer.from('OSXBACKUPR4!'); // 12 bytes
const fingerprint=b=>createHash('sha256').update(b).digest('hex');
function keyBuffer(key){
 const k=Buffer.isBuffer(key)?key:typeof key==='string'?Buffer.from(key,'base64'):Buffer.alloc(0);
 if(k.length!==32)throw Error('BACKUP_ENCRYPTION_KEY must decode to 32 bytes');return k;
}
const aad=m=>Buffer.from([m.format,m.createdAt,m.plainSha256,m.auditHash,m.ledgerTransactions].join('|'));
export async function createEncryptedBackup(db,target,key){
 const output=resolve(target),manifestPath=output+'.manifest.json',partial=output+'.partial';const k=keyBuffer(key);
 if(existsSync(output)||existsSync(manifestPath)||existsSync(partial))throw Error('Backup destination exists; refusing overwrite');
 mkdirSync(dirname(output),{recursive:true});
 const tmp=mkdtempSync(join(tmpdir(),'proof-r4-backup-'));
 try{
  const input=join(tmp,'clear.sqlite');const snapshot=await makeBackup(db,input);const plain=readFileSync(input);
  const iv=randomBytes(12),meta={format:'OSMANX_PROOF_ENCRYPTED_V1',createdAt:new Date().toISOString(),algorithm:'AES-256-GCM',
   plainSha256:fingerprint(plain),auditHash:snapshot.audit.lastHash,ledgerTransactions:snapshot.ledger.transactions};
  const cipher=createCipheriv('aes-256-gcm',k,iv);cipher.setAAD(aad(meta));
  const encrypted=Buffer.concat([cipher.update(plain),cipher.final()]);
  const ciphertext=Buffer.concat([MAGIC,iv,cipher.getAuthTag(),encrypted]);
  const manifest={...meta,cipherSha256:fingerprint(ciphertext),cipherBytes:ciphertext.length,offsiteUploaded:false};
  writeFileSync(partial,ciphertext,{mode:0o600,flag:'wx'});renameSync(partial,output);
  writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n',{mode:0o600,flag:'wx'});
  return {encrypted:true,bytes:ciphertext.length,cipherSha256:manifest.cipherSha256,auditHash:meta.auditHash,
   offsiteUploaded:false,location:output};
 }catch(e){rmSync(partial,{force:true});rmSync(output,{force:true});rmSync(manifestPath,{force:true});throw e}
 finally{rmSync(tmp,{recursive:true,force:true})}
}
export function restoreEncryptedBackup(source,destination,key){
 const input=resolve(source),dest=resolve(destination),partial=dest+'.partial',k=keyBuffer(key);
 if(existsSync(dest)||existsSync(partial))throw Error('Restore destination exists');
 const m=JSON.parse(readFileSync(input+'.manifest.json','utf8'));
 if(m.format!=='OSMANX_PROOF_ENCRYPTED_V1'||m.algorithm!=='AES-256-GCM')throw Error('Encrypted manifest invalid');
 const payload=readFileSync(input);
 if(!payload.subarray(0,12).equals(MAGIC)||payload.length<44||fingerprint(payload)!==m.cipherSha256)throw Error('Encrypted backup SHA-256 mismatch');
 const iv=payload.subarray(12,24),tag=payload.subarray(24,40),body=payload.subarray(40);
 let plain;try{const decipher=createDecipheriv('aes-256-gcm',k,iv);decipher.setAAD(aad(m));decipher.setAuthTag(tag);plain=Buffer.concat([decipher.update(body),decipher.final()]);}
 catch{throw Error('Backup authentication failed: incorrect key or modified ciphertext/metadata')}
 if(fingerprint(plain)!==m.plainSha256)throw Error('Decrypted backup digest mismatch');
 mkdirSync(dirname(dest),{recursive:true});
 try{
  writeFileSync(partial,plain,{mode:0o600,flag:'wx'});
  const verified=verifyBackup(partial,{requireManifest:false});
  if(verified.audit.lastHash!==m.auditHash||verified.ledger.transactions!==m.ledgerTransactions)
   throw Error('Restored audit/ledger does not match authenticated manifest');
  renameSync(partial,dest);
  return {restored:true,location:dest,auditHash:verified.audit.lastHash,verified:true};
 }catch(e){rmSync(partial,{force:true});throw e}
}
