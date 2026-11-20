import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const requiredR7 = Object.freeze([
  'package.json','src/server.mjs','src/partner450.mjs','src/services.mjs',
  'src/stripe-test.mjs','db/schema.sql','docs/R7_PARTNER450_POLICY.md',
  'scripts/r5-release-gate.mjs','scripts/r5-local-acceptance.mjs',
  'scripts/r4-encrypted-drill.mjs','web-next/package.json',
  'db/postgres/011_partner450_rls_smoke.sql',
]);
function present(root,name) {
  const path=join(root,name);
  try {const info=statSync(path);return info.isFile()&&info.size>0;}catch{return false;}
}
function readJson(root,file){try{return JSON.parse(readFileSync(join(root,file),'utf8'));}catch{return null;}}
export function inspectRepository(repository,{claim='R7'}={}) {
 const root=resolve(repository);const missing=requiredR7.filter(x=>!present(root,x));
 const pack=readJson(root,'package.json');
 const scripts=pack?.scripts??{};
 const requiredCommands=['check','acceptance:r5','load:smoke','drill:encrypted'];
 const missingCommands=requiredCommands.filter(x=>typeof scripts[x]!=='string'||!scripts[x].trim());
 const nextLock=present(root,'web-next/package-lock.json');
 const launch13=present(root,'R13_MANIFEST.json')&&present(root,'R13_RELEASE_NOTES.md');
 const claimAllowed=['R7','R13'].includes(claim);
 const failed=[...missing.map(p=>'Missing R7 source: '+p),...missingCommands.map(c=>'Missing command: npm run '+c)];
 if(!pack||pack.type!=='module')failed.push('Invalid root package.json / ESM configuration');
 if(!claimAllowed)failed.push('Unsupported release claim');
 if(claim==='R13'&&!launch13)failed.push('R13 cannot be certified: source and manifest unavailable');
 return {
  report:'OSMANX_SOURCE_INVENTORY_V1',sourceTrack:claim,sourceFilesVerified:failed.length===0,
  requiredFiles:requiredR7.length,missingFiles:missing,missingCommands,
  nextDeterministicInstallReady:nextLock,r13ManifestPresent:launch13,
  backendPackageVersion:pack?.version??null,
  realPaymentsAllowed:false,realPayoutsAllowed:false,
  blockers:failed,
  warnings:[...(!nextLock?['Missing web-next/package-lock.json: reproducible npm ci build unavailable']:[]),
   ...(!launch13?['R8-R13 sources not available in the verified GitHub R7 branch']:[])],
 };
}
function parse(args){let repo='.',claim='R7';for(let i=0;i<args.length;i++){
 if(args[i]==='--repo')repo=args[++i];else if(args[i]==='--claim')claim=args[++i];else throw Error('Unknown option: '+args[i]);
 }return {repo,claim};}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{const opts=parse(process.argv.slice(2)),out=inspectRepository(opts.repo,{claim:opts.claim});console.log(JSON.stringify(out,null,2));if(!out.sourceFilesVerified)process.exitCode=2;}
 catch(e){console.error('Inventory unavailable:',e.message);process.exitCode=2;}
}
