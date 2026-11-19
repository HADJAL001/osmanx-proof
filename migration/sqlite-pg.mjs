import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createServices } from '../src/services.mjs';
const digest=data=>createHash('sha256').update(data).digest('hex');
const expectedSchemaHash=digest(readFileSync(new URL('../db/schema.sql',import.meta.url)));
const tables=db=>db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>r.name);
function schemaCatalog(){
 const db=new DatabaseSync(':memory:');try{db.exec(readFileSync(new URL('../db/schema.sql',import.meta.url),'utf8'));
  return new Map(tables(db).map(name=>[name,db.prepare(`PRAGMA table_info("${name}")`).all().map(x=>x.name)]));
 }finally{db.close()}
}
function comparableValue(actual,expected){
 if(actual===expected)return true;
 if(Number.isSafeInteger(expected)&&typeof actual==='string'&&/^-?\d+$/.test(actual))return BigInt(actual)===BigInt(expected);
 return false;
}

function orderTables(db,names){
 const tableNames=new Set(names), deps=new Map();
 for(const table of names)deps.set(table,new Set(db.prepare(`PRAGMA foreign_key_list("${table}")`).all().map(x=>x.table).filter(t=>t!==table&&tableNames.has(t))));
 const result=[];while(deps.size){const ready=[...deps].filter(([,v])=>!v.size).map(([k])=>k).sort();if(!ready.length)throw Error('Foreign key table cycle; manual migration required');for(const t of ready){result.push(t);deps.delete(t);for(const v of deps.values())v.delete(t)}}return result;
}
export function verifySnapshot(dir){
 const home=resolve(dir),manifestPath=join(home,'manifest.json');
 const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
 if(manifest.format!=='OSMANX_PROOF_PG_CUTOVER_V1'||!Array.isArray(manifest.tables))throw Error('Invalid snapshot manifest');
 if(manifest.schemaSha256!==expectedSchemaHash)throw Error('Source schema version mismatch');
 const catalog=schemaCatalog();
 if(manifest.tables.length!==catalog.size)throw Error('Snapshot table inventory mismatch');
 const names=new Set(),result=[];for(const entry of manifest.tables){
  if(!/^[a-z][a-z0-9_]*$/.test(entry.name)||names.has(entry.name)||!Number.isSafeInteger(entry.rows)||entry.rows<0)throw Error('Invalid table metadata');names.add(entry.name);
  if(!catalog.has(entry.name)||!Array.isArray(entry.columns)||JSON.stringify(entry.columns)!==JSON.stringify(catalog.get(entry.name)))throw Error('Snapshot schema inventory mismatch: '+entry.name);
  const path=join(home,entry.name+'.jsonl'),raw=readFileSync(path);
  if(digest(raw)!==entry.sha256)throw Error('Snapshot digest mismatch: '+entry.name);
  const rows=raw.length?raw.toString('utf8').trimEnd().split('\n').map(l=>JSON.parse(l)):[];
  if(rows.length!==entry.rows||rows.some(r=>!r||Array.isArray(r)||typeof r!=='object'))throw Error('Snapshot row count invalid: '+entry.name);
  result.push({name:entry.name,rows});
 }
 if(digest(JSON.stringify(manifest.tables))!==manifest.tablesDigest)throw Error('Snapshot index digest mismatch');
 if([...catalog.keys()].some(name=>!names.has(name)))throw Error('Missing snapshot table');
 if(manifest.tables.some(x=>!names.has(x.name)))throw Error('Invalid table index');
 return {manifest,result};
}
export function exportSqliteForPostgres(db,outDir){
 const out=resolve(outDir);
 if(existsSync(out))throw Error('Destination already exists; export will never overwrite');
 mkdirSync(out,{recursive:false,mode:0o700});
 try{
  db.exec('BEGIN');
  const svc=createServices(db),audit=svc.verifyAudit(),ledger=svc.verifyLedger();
  if(!audit.ok||!ledger.ok||db.prepare('PRAGMA integrity_check').get()?.integrity_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Source integrity/ledger/audit check failed');
  const names=orderTables(db,tables(db)),metadata=[];
  for(const table of names){
   const cols=db.prepare(`PRAGMA table_info("${table}")`).all().map(x=>x.name);
   const orderBy=cols.includes('seq')?'seq':cols.includes('id')?'id':cols[0];
   const rows=db.prepare(`SELECT * FROM "${table}" ORDER BY "${orderBy}"`).all();
   const raw=rows.map(row=>JSON.stringify(row)).join('\n')+(rows.length?'\n':'');
   writeFileSync(join(out,table+'.jsonl'),raw,{mode:0o600,flag:'wx'});
   metadata.push({name:table,rows:rows.length,columns:cols,sha256:digest(raw)});
  }
  db.exec('COMMIT');
  const manifest={format:'OSMANX_PROOF_PG_CUTOVER_V1',createdAt:new Date().toISOString(),source:'SQLite',schemaSha256:expectedSchemaHash,sensitive:true,requiresEncryptedStorage:true,ledgerTransactions:ledger.transactions,auditEvents:audit.checked,auditHash:audit.lastHash,tables:metadata,tablesDigest:digest(JSON.stringify(metadata))};
  writeFileSync(join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o600,flag:'wx'});
  return {directory:out,tables:metadata.length,rows:metadata.reduce((s,t)=>s+t.rows,0),auditHash:audit.lastHash};
 }catch(err){try{db.exec('ROLLBACK')}catch{}rmSync(out,{recursive:true,force:true});throw err}
}
export function replayToFreshSQLite(exportDir,sqlitePath,schemaPath){
 const {manifest,result}=verifySnapshot(exportDir);const dest=resolve(sqlitePath);
 if(existsSync(dest))throw Error('Replay destination exists');
 const db=new DatabaseSync(dest);
 try{
  db.exec('PRAGMA foreign_keys=ON');db.exec(readFileSync(resolve(schemaPath),'utf8'));
  db.exec('BEGIN IMMEDIATE');
  for(const {name,rows} of result){const table=manifest.tables.find(x=>x.name===name),cols=table.columns;
   if(!cols.every(k=>/^[a-z][a-z0-9_]*$/.test(k)))throw Error('Unsafe column');
   const sql=`INSERT INTO "${name}" (${cols.map(c=>'"'+c+'"').join(',')}) VALUES (${cols.map(()=>'?').join(',')})`;
   const q=db.prepare(sql);for(const row of rows)q.run(...cols.map(c=>row[c]));
  }
  db.exec('COMMIT');const svc=createServices(db);const audit=svc.verifyAudit(),ledger=svc.verifyLedger();
  if(!audit.ok||!ledger.ok||audit.lastHash!==manifest.auditHash||ledger.transactions!==manifest.ledgerTransactions||db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Replayed database not equivalent');
  return {ok:true,tables:result.length,auditHash:audit.lastHash};
 }catch(err){try{db.exec('ROLLBACK')}catch{}throw err}finally{db.close()}
}
export async function importIntoPostgres(exportDir,{connectionString,client}={}){
 const {manifest,result}=verifySnapshot(exportDir);
 if(!connectionString&&!client)throw Error('PostgreSQL connection required');
 // Only available in an explicitly configured environment with the pg driver installed.
 let owned=false;if(!client){let Client;try{({Client}=await import('pg'))}catch{throw Error('PostgreSQL migration requires pg driver: install it in the approved migration environment')}client=new Client({connectionString,ssl:process.env.PG_SSL==='require'?{rejectUnauthorized:true}:undefined});await client.connect();owned=true}
 try{
  await client.query('BEGIN');
  for(const {name,rows} of result){const meta=manifest.tables.find(t=>t.name===name);const cols=meta.columns;
   for(const row of rows){const params=cols.map(c=>row[c]);const sql=`INSERT INTO "${name}" (${cols.map(c=>'"'+c+'"').join(',')}) VALUES (${cols.map((_,i)=>'$'+(i+1)).join(',')})`;
    await client.query(sql,params);
   }
  }
  await client.query("SELECT setval(pg_get_serial_sequence('audit_events','seq'),COALESCE((SELECT MAX(seq) FROM audit_events),1),(SELECT count(*)>0 FROM audit_events))");
  // R4: verify every field, not only counts. Equal counts can conceal rewritten amounts or owners.
  for(const {name,rows:expected} of result){
   const meta=manifest.tables.find(x=>x.name===name),cols=meta.columns;
   const key=cols.includes('seq')?'seq':cols.includes('id')?'id':cols[0];
   const query=`SELECT ${cols.map(c=>'"'+c+'"').join(',')} FROM "${name}" ORDER BY "${key}"`;
   const actual=(await client.query(query)).rows;
   if(actual.length!==expected.length)throw Error('PostgreSQL row count mismatch: '+name);
   for(let index=0;index<expected.length;index++){
    const before=expected[index],after=actual[index];
    for(const col of cols)if(!comparableValue(after[col],before[col]))
     throw Error(`PostgreSQL content mismatch: ${name} row ${index} column ${col}`);
   }
  }
  await client.query('COMMIT');return {ok:true,verifiedContent:true,tables:manifest.tables.length,rows:manifest.tables.reduce((s,t)=>s+t.rows,0)};
 }catch(err){await client.query('ROLLBACK');throw err}finally{if(owned)await client.end()}
}
