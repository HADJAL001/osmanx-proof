#!/usr/bin/env node
// Conservative check for accidentally committed runtime data or common credentials.
// This is not a substitute for dedicated secret scanning or a code review.
import {execFileSync} from 'node:child_process';
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const refs=git('for-each-ref','--format=%(refname:short)','refs/heads','refs/tags').split('\n').filter(Boolean);
const forbidden=(name)=>{
  const parts=name.split('/');const leaf=parts.at(-1);
  if(parts.some(p=>['data','node_modules','.next','backups','secrets','exports','migration-exports'].includes(p)))return true;
  if(leaf==='.env'||leaf==='.npmrc'||leaf==='id_rsa'||(leaf.startsWith('.env.')&&leaf!=='.env.example'))return true;
  if(/\.(?:sqlite(?:3|-wal|-shm)?|db|pem|key|p12|pfx|vault|secret|log|bundle)$/i.test(leaf))return true;
  return false;
};
const problem=[];
for(const ref of refs){
  for(const name of git('ls-tree','-r','--name-only',ref).split('\n').filter(Boolean)){
    if(forbidden(name))problem.push(`${ref}: ${name}`);
  }
}
// Common examples use short negative-test strings; real-looking secrets are rejected.
const signatures=[
  /ghp_[A-Za-z0-9]{30,}/,
  /github_pat_[A-Za-z0-9_]{45,}/,
  /sk_live_[A-Za-z0-9]{24,}/,
  /AKIA[A-Z0-9]{16}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/
];
for(const ref of refs){
  const paths=git('ls-tree','-r','--name-only',ref).split('\n').filter(Boolean);
  for(const path of paths){
    if(/\.(png|jpg|jpeg|webp|zip|bundle|pdf)$/i.test(path))continue;
    const blob=execFileSync('git',['show',`${ref}:${path}`],{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:8*1024*1024});
    for(const rg of signatures) if(rg.test(blob))problem.push(`${ref}: potential credential at ${path}`);
  }
}
if(problem.length){console.error('GitHub preflight FAILED:\n'+[...new Set(problem)].join('\n'));process.exit(1)}
console.log(`PASS: scanned ${refs.length} branches/tags; no forbidden tracked files or high-confidence secret signatures found.`);
