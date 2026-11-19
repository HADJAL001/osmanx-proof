import { openDatabase } from '../src/db.mjs';
import { existsSync } from 'node:fs';
import { exportSqliteForPostgres,verifySnapshot,replayToFreshSQLite,importIntoPostgres } from './sqlite-pg.mjs';
const [cmd,...args]=process.argv.slice(2);
if(cmd==='export'){
 if(process.env.ALLOW_SENSITIVE_EXPORT!=='I_UNDERSTAND')throw Error('Sensitive export is disabled. Explicitly set ALLOW_SENSITIVE_EXPORT=I_UNDERSTAND');
 if(!args[0]||!args[1]||!existsSync(args[0]))throw Error('Specify existing SQLite source and a new destination directory');
 const db=openDatabase(args[0]);try{console.log(exportSqliteForPostgres(db,args[1]))}finally{db.close()}
}else if(cmd==='verify'){const x=verifySnapshot(args[0]);console.log({tables:x.result.length,rows:x.manifest.tables.reduce((s,t)=>s+t.rows,0)})}
else if(cmd==='replay')console.log(replayToFreshSQLite(args[0],args[1],new URL('../db/schema.sql',import.meta.url).pathname));
else if(cmd==='import-pg'){if(process.env.ALLOW_PG_IMPORT!=='I_UNDERSTAND')throw Error('PostgreSQL import locked');console.log(await importIntoPostgres(args[0],{connectionString:process.env.PG_ADMIN_URL}))}
else throw Error('Usage: export <source.sqlite> <new-dir> | verify <dir> | replay <dir> <new.sqlite> | import-pg <dir>');
