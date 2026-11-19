import { openDatabase } from './db.mjs';
import { makeBackup, verifyBackup, restoreBackup } from './ops.mjs';
const [command,source,target] = process.argv.slice(2);
const usage='Usage: npm run backup -- /path/backup.sqlite | npm run backup:verify -- /path/backup.sqlite | npm run restore -- /path/backup.sqlite /path/new.sqlite';
try {
 let result;
 if(command==='backup'&&source){const db=openDatabase(process.env.DATABASE_PATH);try{result=await makeBackup(db,source);}finally{db.close();}}
 else if(command==='verify'&&source)result=verifyBackup(source);
 else if(command==='restore'&&source&&target)result=restoreBackup(source,target);
 else throw Error(usage);
 console.log(JSON.stringify({ok:true,...result},null,2));
}catch(e){console.error('OPERATION FAILED:',e.message);process.exitCode=1;}
