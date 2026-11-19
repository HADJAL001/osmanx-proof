import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openDatabase} from '../src/db.mjs';
import {makeBackup,verifyBackup,restoreBackup} from '../src/ops.mjs';
export async function recoveryDrill(db){
 const dir=mkdtempSync(join(tmpdir(),'proof-r3-drill-'));
 try{const backup=join(dir,'snapshot.sqlite');const made=await makeBackup(db,backup);
  const copy=restoreBackup(backup,join(dir,'restored.sqlite'));
  if(!copy.verified||copy.auditHash!==made.audit.lastHash)throw Error('Recovery drill divergence');
  return {ok:true,sha256:copy.sha256,auditHash:copy.auditHash,ledgerTransactions:made.ledger.transactions};
 }finally{rmSync(dir,{recursive:true,force:true})}
}
if(process.argv[1]?.endsWith('recovery-drill.mjs')){
 const db=openDatabase();try{console.log(await recoveryDrill(db))}finally{db.close()}
}
