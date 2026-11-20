import {existsSync,readFileSync} from 'node:fs';
import {resolve,dirname,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {inspectRepository} from './pilot-inventory.mjs';

const stages={
 demo:['backend','http','encryptedRestore'],
 beta:['backend','http','load','encryptedRestore','browser','tlsStaging','tenantIsolation','privacyReview'],
 paid:['backend','http','load','encryptedRestore','nextBuild','postgresRls','browser','tlsStaging','tenantIsolation','privacyReview',
  'securityReview','legalReview','merchantProvider','refundReconciliation','actualCostReview'],
};
export const stageNames=Object.freeze(Object.keys(stages));
const sha256=b=>createHash('sha256').update(b).digest('hex');
function validEvidence(root,e){
 if(!e||e.status!=='pass'||typeof e.file!=='string'||typeof e.sha256!=='string'||!/^[a-f0-9]{64}$/.test(e.sha256))return false;
 const pathname=resolve(root,e.file);if(pathname===root||(!pathname.startsWith(root+sep)))return false;
 try{return existsSync(pathname)&&sha256(readFileSync(pathname))===e.sha256;}catch{return false;}
}
export function evaluateLaunchGate({repository='.',stage='beta',claim='R7',evidence={},evidenceRoot=repository,sourceInspection}={}){
 if(!Object.hasOwn(stages,stage))throw Error('Stage must be demo | beta | paid');
 const root=resolve(repository),inventory=sourceInspection??inspectRepository(root,{claim});
 const failed=[...inventory.blockers],checks={};
 const provided=evidence?.checks||{};
 for(const key of stages[stage]){
  const passed=validEvidence(resolve(evidenceRoot),provided[key]);checks[key]={pass:passed,reason:passed?'Verified local report hash':'Missing or mismatched report file+SHA-256'};
  if(!passed)failed.push(key+': '+checks[key].reason);
 }
 if(stage==='demo'){
  // This only certifies a local noncommercial demo, never a publicly accessible product.
  if(evidence?.nonCommercial!==true)failed.push('Demo must explicitly be noncommercial');
 }else{
  if(!/^[a-f0-9]{40}$/.test(evidence?.commitSha||''))failed.push('Immutable source commit SHA missing');
  if(evidence?.independentReview!==true)failed.push('Independent staging review not documented');
  if(evidence?.publicAccessible!==true)failed.push('Real HTTPS staging deployment not documented');
  if(!inventory.nextDeterministicInstallReady)failed.push('Reproducible web-next npm ci requires committed package-lock.json');
  if(claim==='R13'&&!inventory.r13ManifestPresent)failed.push('Full R13 source must be present to claim R13');
 }
 if(stage==='paid'){
  if(evidence?.realMoneyMode!==true)failed.push('Real merchant and payout permissions have not been authorized');
  if(evidence?.legalApprovals!==true)failed.push('Specific legal approvals are absent');
 }
 return {format:'OSMANX_PILOT_LAUNCH_GATE_V1',stage,sourceClaim:claim,
  decision:failed.length?'NO_GO':stage==='demo'?'LOCAL_DEMO_ONLY':'READY_FOR_INDEPENDENT_APPROVAL',
  approvedForRealPayments:false,approvedForRealPayouts:false,failures:failed,checks,
  notice:'Cryptographic hashes verify local bytes only; they do not prove an external reviewer, real transactions, or vendor compliance. Commercial deployment requires separate authorization.'};
}
function parse(args){let repo='.',stage='beta',claim='R7',input=null,expectBlocked=false;
 for(let i=0;i<args.length;i++){if(args[i]==='--repo')repo=args[++i];else if(args[i]==='--stage')stage=args[++i];else if(args[i]==='--claim')claim=args[++i];else if(args[i]==='--evidence')input=args[++i];else if(args[i]==='--expect-blocked')expectBlocked=true;else throw Error('Invalid option '+args[i]);}return {repo,stage,claim,input,expectBlocked};}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{const x=parse(process.argv.slice(2)),evidence=x.input?JSON.parse(readFileSync(x.input,'utf8')):{};
  const result=evaluateLaunchGate({repository:x.repo,stage:x.stage,claim:x.claim,evidence,evidenceRoot:x.input?dirname(resolve(x.input)):x.repo});console.log(JSON.stringify(result,null,2));
  const blocked=result.decision==='NO_GO';if(x.expectBlocked?!blocked:blocked)process.exitCode=1;
 }catch(e){console.error('Launch gate rejected:',e.message);process.exitCode=2;}
}
