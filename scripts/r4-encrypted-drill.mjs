import {randomBytes} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../src/db.mjs';
import {createEncryptedBackup,restoreEncryptedBackup} from '../src/ops-encrypted.mjs';
import {verifyBackup} from '../src/ops.mjs';
export async function encryptedDrill(db){
 const dir=mkdtempSync(join(tmpdir(),'proof-r4-crypt-drill-'));
 try{
  const key=randomBytes(32),src=join(dir,'backup.enc'),out=join(dir,'restored.sqlite');
  const created=await createEncryptedBackup(db,src,key);
  const restored=restoreEncryptedBackup(src,out,key);
  const checked=verifyBackup(out,{requireManifest:false});
  if(!checked.ok||restored.auditHash!==created.auditHash)throw Error('Encrypted recovery drill mismatch');
  return {ok:true,encrypted:true,restored:true,offsiteUploaded:false,auditHash:restored.auditHash};
 }finally{rmSync(dir,{recursive:true,force:true})}
}
if(process.argv[1]?.endsWith('r4-encrypted-drill.mjs')){
 const db=openDatabase();encryptedDrill(db).then(x=>console.log(JSON.stringify(x,null,2))).catch(e=>{console.error(e);process.exitCode=1}).finally(()=>db.close());
}
