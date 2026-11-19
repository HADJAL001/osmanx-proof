// R6: private, encrypted, tenant-scoped evidence vault. All files start quarantined.
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, unlinkSync, lstatSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { one, all, run, transaction } from './db.mjs';
import { assert, newId, sha, cleanText } from './security.mjs';

export const MAX_EVIDENCE_BYTES=2*1024*1024;
const allowed={'application/pdf':'pdf','image/png':'png','image/jpeg':'jpg','text/plain':'txt'};
const checksum=bytes=>createHash('sha256').update(bytes).digest('hex');
function sniff(buf){
 if(buf.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
 if(buf.subarray(0,3).equals(Buffer.from([255,216,255])))return 'image/jpeg';
 if(buf.subarray(0,5).toString('ascii')==='%PDF-')return 'application/pdf';
 if(buf.includes(0)||buf.some(b=>b<9||(b>13&&b<32)))return null;
 try{new TextDecoder('utf-8',{fatal:true}).decode(buf);return 'text/plain';}catch{return null;}
}
function keyFrom(value){
 if(Buffer.isBuffer(value))return value.length===32?value:null;
 if(typeof value==='string'&&/^[0-9a-f]{64}$/i.test(value))return Buffer.from(value,'hex');
 return null;
}
function decode64(s){
 assert(typeof s==='string'&&s.length>0&&s.length<=Math.ceil(MAX_EVIDENCE_BYTES/3)*4+4&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(s),422,'Canonical base64 required');
 const value=Buffer.from(s,'base64');
 assert(value.length>0&&value.length<=MAX_EVIDENCE_BYTES&&value.toString('base64')===s,413,'Evidence must be 1–2 MiB or smaller');
 return value;
}
export function scanAttestation(secret,{id,digest,verdict,engine}){
 return createHmac('sha256',secret).update([id,digest,verdict,engine].join('|')).digest('hex');
}
export function createEvidence(db,{member,admin,audit,clock,dir,key,scannerSecret}={}){
 const encryptionKey=keyFrom(key??process.env.EVIDENCE_ENCRYPTION_KEY);
 const scanKey=scannerSecret??process.env.EVIDENCE_SCANNER_SECRET??'';
 const root=resolve(dir??process.env.EVIDENCE_DIR??'./data/evidence');
 const enabled=()=>assert(encryptionKey,503,'Evidence vault is disabled until a 32-byte encryption key is configured','VAULT_DISABLED');
 const pathFor=id=>join(root,id+'.vault'); // UUIDs are generated server-side, not user-supplied.
 const owner=(actor,projectId,milestoneId,roles=['owner','editor','viewer'])=>{
  const row=one(db,`SELECT m.id,m.status,m.project_id,p.org_id,p.status AS project_status FROM work_milestones m
   JOIN work_projects p ON p.id=m.project_id WHERE p.id=? AND m.id=?`,projectId,milestoneId);
  assert(row,404,'Milestone not found'); member(actor,row.org_id,roles);return row;
 };
 const located=(assetId)=>{
  assert(typeof assetId==='string'&&/^[0-9a-f-]{36}$/.test(assetId),404,'Evidence not found');
  const asset=one(db,'SELECT * FROM work_evidence WHERE id=?',assetId);
  assert(asset,404,'Evidence not found');return asset;
 };
 const meta=a=>({id:a.id,projectId:a.project_id,milestoneId:a.milestone_id,fileName:a.file_name,mime:a.mime_type,
  size:a.size_bytes,sha256:a.sha256,status:a.status,createdAt:a.created_at,scannedAt:a.scanned_at});
 function upload(actor,projectId,milestoneId,data){
  enabled();const milestone=owner(actor,projectId,milestoneId,['owner','editor']);
  assert(milestone.project_status==='active'&&['planned','in_progress','changes_requested'].includes(milestone.status),409,'Cannot add evidence after submission');
  const fileName=cleanText(basename(String(data?.fileName||'').replaceAll('\\','/')),120);
  assert(fileName.length>=2&&!/[\x00-\x1f]/.test(fileName),422,'Valid file name required');
  const buf=decode64(data?.contentBase64),actual=sniff(buf);
  assert(actual&&allowed[actual]&&actual===data.mime,415,'Unsupported or mismatched file format');
  assert(fileName.toLowerCase().endsWith('.'+allowed[actual])||(actual==='image/jpeg'&&fileName.toLowerCase().endsWith('.jpeg')),415,'File extension mismatch');
  const count=one(db,'SELECT count(*) AS n FROM work_evidence WHERE milestone_id=?',milestoneId).n;
  assert(count<15,409,'Maximum 15 evidence files per milestone');
  const id=newId(),digest=checksum(buf),nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',encryptionKey,nonce);
  cipher.setAAD(Buffer.from(`${id}:${digest}:${buf.length}`));
  const encrypted=Buffer.concat([cipher.update(buf),cipher.final()]);
  const payload=Buffer.concat([nonce,cipher.getAuthTag(),encrypted]);
  mkdirSync(root,{recursive:true,mode:0o700});
  writeFileSync(pathFor(id),payload,{flag:'wx',mode:0o600});
  try{return transaction(db,()=>{
   run(db,`INSERT INTO work_evidence(id,project_id,milestone_id,file_name,mime_type,size_bytes,sha256,status,created_by,created_at)
    VALUES(?,?,?,?,?,?,?,'quarantined',?,?)`,id,projectId,milestoneId,fileName,actual,buf.length,digest,actor,clock());
   audit(actor,'work.evidence.uploaded',id,{projectId,milestoneId,sha256:digest,status:'quarantined'});
   return meta(located(id));
  })}catch(e){unlinkSync(pathFor(id));throw e}
 }
 function scan(actor,id,{verdict,engine,attestation}){enabled();admin(actor);
  assert(['clean','infected'].includes(verdict)&&typeof engine==='string'&&/^[a-zA-Z0-9_.-]{3,60}$/.test(engine),422,'Scanner evidence required');
  assert(typeof scanKey==='string'&&scanKey.length>=32,503,'Scanner attestation key is not configured');
  const a=located(id);assert(a.status==='quarantined',409,'Evidence already classified');
  const expected=scanAttestation(scanKey,{id,digest:a.sha256,verdict,engine});
  assert(typeof attestation==='string'&&/^[0-9a-f]{64}$/.test(attestation)&&timingSafeEqual(Buffer.from(attestation,'hex'),Buffer.from(expected,'hex')),403,'Invalid scanner attestation');
  // Verify encrypted content before accepting a scanner decision.
  readDecrypted(a);
  return transaction(db,()=>{
   run(db,'UPDATE work_evidence SET status=?,scan_engine=?,scanned_at=? WHERE id=?',verdict==='clean'?'cleared':'rejected',engine,clock(),id);
   audit(actor,'work.evidence.scan',id,{verdict,engine,digest:a.sha256});return meta(located(id));
  });
 }
 function readDecrypted(a){enabled();const p=pathFor(a.id);
  const stat=lstatSync(p);assert(stat.isFile()&&!stat.isSymbolicLink()&&stat.size>=28&&stat.size<=MAX_EVIDENCE_BYTES+28,409,'Invalid vault file');
  const encrypted=readFileSync(p),nonce=encrypted.subarray(0,12),tag=encrypted.subarray(12,28),ciphertext=encrypted.subarray(28);
  let plain;
  try{const decipher=createDecipheriv('aes-256-gcm',encryptionKey,nonce);decipher.setAAD(Buffer.from(`${a.id}:${a.sha256}:${a.size_bytes}`));decipher.setAuthTag(tag);plain=Buffer.concat([decipher.update(ciphertext),decipher.final()]);}
  catch{assert(false,409,'Evidence integrity verification failed','EVIDENCE_INTEGRITY')}
  assert(plain.length===a.size_bytes&&checksum(plain)===a.sha256,409,'Evidence content hash mismatch','EVIDENCE_INTEGRITY');return plain;
 }
 function list(actor,projectId,milestoneId){owner(actor,projectId,milestoneId);return all(db,
  'SELECT * FROM work_evidence WHERE project_id=? AND milestone_id=? ORDER BY created_at,id',projectId,milestoneId).map(meta);
 }
 function download(actor,projectId,id){const a=located(id);assert(a.project_id===projectId,404,'Evidence not found');
  owner(actor,projectId,a.milestone_id);assert(a.status==='cleared',403,'Evidence not cleared by scanner');
  return {data:readDecrypted(a),metadata:meta(a)};
 }
 function publicDownload(raw,id){const a=located(id);
  assert(typeof raw==='string'&&raw.length>=30&&raw.length<=256,404,'Client link unavailable');
  const share=one(db,`SELECT * FROM work_client_shares WHERE token_hash=? AND revoked_at IS NULL AND expires_at>?`,sha(raw),clock());
  assert(share&&share.project_id===a.project_id,404,'Evidence unavailable');
  const m=one(db,'SELECT status FROM work_milestones WHERE id=? AND project_id=?',a.milestone_id,a.project_id);
  assert(m&&['submitted','accepted'].includes(m.status),404,'Evidence unavailable');
  const s=one(db,'SELECT id FROM work_submissions WHERE milestone_id=? ORDER BY revision DESC LIMIT 1',a.milestone_id);
  assert(s&&one(db,'SELECT 1 FROM work_submission_evidence WHERE submission_id=? AND evidence_id=?',s.id,a.id),404,'Evidence unavailable');
  assert(a.status==='cleared',404,'Evidence not cleared by scanner');
  return {data:readDecrypted(a),metadata:meta(a)};
 }
 function evidenceForSubmission(submissionId){return all(db,`SELECT e.id,e.file_name AS fileName,e.mime_type AS mime,e.size_bytes AS size,e.sha256,e.status
  FROM work_evidence e JOIN work_submission_evidence se ON se.evidence_id=e.id WHERE se.submission_id=? ORDER BY e.id`,submissionId);
 }
 function verifyStore(){enabled();let count=0;for(const a of all(db,'SELECT * FROM work_evidence')){readDecrypted(a);count++}return {ok:true,verified:count}}
 return {upload,scan,list,download,publicDownload,evidenceForSubmission,verifyStore,enabled};
}
