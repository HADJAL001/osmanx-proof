import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync,existsSync, mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {inspectRepository} from './pilot-inventory.mjs';

const sha256=b=>createHash('sha256').update(b).digest('hex');
export function runCheck(command,args,{cwd='.',timeoutMs=90_000,env={}}={}){
 if(typeof command!=='string'||!command||!Array.isArray(args))throw Error('Invalid command');
 const result=spawnSync(command,args,{cwd:resolve(cwd),encoding:'utf8',timeout:timeoutMs,maxBuffer:4*1024*1024,
  env:{...process.env,...env,PAYMENT_MODE:'disabled',PAYOUTS_ENABLED:'0',STRIPE_TEST_SECRET_KEY:'',STRIPE_TEST_WEBHOOK_SECRET:''}});
 return {ok:result.status===0&&!result.error,code:result.status,timeout:result.error?.code==='ETIMEDOUT',signal:result.signal,
  output:[result.stdout||'',result.stderr||''].join('\n').slice(-280_000)};
}
export function verifySource(repository,{outputDirectory,includeNext=false,timeoutMs=180_000}={}){
 const repo=resolve(repository),inventory=inspectRepository(repo),out=resolve(outputDirectory||mkdtempSync(join(tmpdir(),'osmanx-pilot-')));
 mkdirSync(out,{recursive:true});const steps=[['backend','check'],['http','acceptance:r5'],['load','load:smoke'],['encryptedRestore','drill:encrypted']];
 const reports={},sandbox=mkdtempSync(join(tmpdir(),'osmanx-pilot-isolate-'));
 for(const [name,script] of steps){
  const p=join(out,`${name}.log`);
  const res=inventory.sourceFilesVerified?runCheck('npm',['run',script],{cwd:repo,timeoutMs,env:{DATABASE_PATH:join(sandbox,`${name}.sqlite`)}}):{ok:false,code:null,timeout:false,output:'Source inventory invalid; cannot run tests'};
  writeFileSync(p,res.output);reports[name]={status:res.ok?'pass':'fail',file:p,sha256:sha256(readFileSync(p)),exitCode:res.code,timedOut:res.timeout};
 }
 if(includeNext){
  if(inventory.nextDeterministicInstallReady){const p=join(out,'nextBuild.log');const res=runCheck('npm',['ci','--ignore-scripts','--no-audit','--no-fund'],{cwd:join(repo,'web-next'),timeoutMs});let build=res;
   if(res.ok)build=runCheck('npm',['run','build'],{cwd:join(repo,'web-next'),timeoutMs});writeFileSync(p,build.output);reports.nextBuild={status:build.ok?'pass':'fail',file:p,sha256:sha256(readFileSync(p))};
  }else reports.nextBuild={status:'blocked',reason:'web-next package-lock missing; do not substitute non-reproducible npm install'};
 }
 const evidence={format:'OSMANX_PILOT_LOCAL_EVIDENCE_V1',nonCommercial:true,sourceVersion:inventory.backendPackageVersion,checks:reports,
  warnings:['Results reflect local tests only; not production authorization','Local scripts must not replace external browser, legal or merchant verification']};
 const reportFile=join(out,'evidence.json');writeFileSync(reportFile,JSON.stringify(evidence,null,2)+'\n');
 return {source:inventory,checks:reports,evidenceFile:reportFile,allLocalChecksPassed:steps.every(([name])=>reports[name].status==='pass')};
}
function parse(args){let repo='.',outputDirectory=null,includeNext=false;
 for(let i=0;i<args.length;i++){if(args[i]==='--repo')repo=args[++i];else if(args[i]==='--output')outputDirectory=args[++i];else if(args[i]==='--include-next')includeNext=true;else throw Error('Unknown option '+args[i]);}return {repo,outputDirectory,includeNext};}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{const p=parse(process.argv.slice(2)),r=verifySource(p.repo,p);console.log(JSON.stringify(r,null,2));if(!r.allLocalChecksPassed)process.exitCode=1;}
 catch(e){console.error('Local acceptance failed:',e.message);process.exitCode=2;}
}
