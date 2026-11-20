import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {inspectRepository} from '../scripts/pilot-inventory.mjs';
import {evaluateSale,forecastMix,packageAssumptions} from '../scripts/pilot-economics.mjs';
import {analyzeCsv,COLUMNS} from '../scripts/pilot-metrics.mjs';
import {evaluateLaunchGate} from '../scripts/pilot-gate.mjs';
import {runCheck} from '../scripts/pilot-verify.mjs';
const dir=()=>mkdtempSync(join(tmpdir(),'osmanx-launch-test-'));
const clean=(name,fn)=>test(name,()=>{const path=dir();try{return fn(path);}finally{rmSync(path,{recursive:true,force:true});}});
const sha=x=>createHash('sha256').update(x).digest('hex');
function fixtureRepo(root,{lock=false,r13=false}={}){
 const paths=['src/server.mjs','src/partner450.mjs','src/services.mjs','src/stripe-test.mjs','db/schema.sql','docs/R7_PARTNER450_POLICY.md','scripts/r5-release-gate.mjs','scripts/r5-local-acceptance.mjs','scripts/r4-encrypted-drill.mjs','web-next/package.json','db/postgres/011_partner450_rls_smoke.sql'];
 for(const file of paths){mkdirSync(join(root,file.split('/').slice(0,-1).join('/')),{recursive:true});writeFileSync(join(root,file),'TEST ONLY\n');}
 writeFileSync(join(root,'package.json'),JSON.stringify({name:'pilot-test',version:'7.0.0',type:'module',scripts:{check:'echo check','acceptance:r5':'echo http','load:smoke':'echo load','drill:encrypted':'echo backup'}}));
 if(lock)writeFileSync(join(root,'web-next/package-lock.json'),'{}');
 if(r13){writeFileSync(join(root,'R13_MANIFEST.json'),'{}');writeFileSync(join(root,'R13_RELEASE_NOTES.md'),'R13');}
 return root;
}
const record=(root,key,content='PASS')=>{const name=key+'.log';writeFileSync(join(root,name),content);return {status:'pass',file:name,sha256:sha(content)};};
const row=(values={})=>{const original={lead_id:'lead0001',channel:'visits',qualified:'1',proposal_sent:'1',proposal_accepted:'1',paid_confirmed:'1',delivered:'1',client_accepted:'1',refund_cents:'0',price_cents:'4000000',delivery_cents:'1800000',tax_cents:'480000',fees_cents:'120000',partner_commission_cents:'400000',test_only:'1'};return COLUMNS.map(x=>({...original,...values})[x]).join(',');};
const csv=(...rows)=>COLUMNS.join(',')+'\n'+rows.join('\n')+'\n';

clean('Inventory R7: present files pass, missing Next lock reported separately',root=>{fixtureRepo(root);const r=inspectRepository(root);assert.equal(r.sourceFilesVerified,true);assert.equal(r.nextDeterministicInstallReady,false);assert.equal(r.backendPackageVersion,'7.0.0');assert.equal(r.realPaymentsAllowed,false);});
clean('Inventory R7: absent files prevent release identity confirmation',root=>{const r=inspectRepository(root);assert.equal(r.sourceFilesVerified,false);assert(r.blockers.some(x=>x.includes('src/server.mjs')));});
clean('Inventory R13: cannot claim R13 from R7 source',root=>{fixtureRepo(root);const r=inspectRepository(root,{claim:'R13'});assert.equal(r.sourceFilesVerified,false);assert(r.blockers.some(x=>x.includes('R13')));});
clean('Inventory R13: manifests make claim structurally available but do not verify builds',root=>{fixtureRepo(root,{r13:true});const r=inspectRepository(root,{claim:'R13'});assert.equal(r.sourceFilesVerified,true);assert.equal(r.r13ManifestPresent,true);});
clean('Inventory rejects missing launch commands',root=>{fixtureRepo(root);writeFileSync(join(root,'package.json'),'{}');const r=inspectRepository(root);assert(r.missingCommands.length>0);});

test('Growth R7 illustrative commission 4000 RUB, not cashout',()=>{const r=evaluateSale({...packageAssumptions.growth_setup_40k,partner:true});assert.equal(r.commissionCents,400000);assert.equal(r.contributionCents,1_200_000);assert.equal(r.realPayout,false);});
test('Enterprise R7 illustrative commission 20000 RUB, not cashout',()=>{const r=evaluateSale({...packageAssumptions.enterprise_setup_200k,partner:true});assert.equal(r.commissionCents,2_000_000);assert.equal(r.contributionCents,5_000_000);});
test('No partner — no partner commission',()=>assert.equal(evaluateSale({...packageAssumptions.growth_setup_40k,partner:false}).commissionCents,0));
test('Zero or negative margin cannot fund affiliate commission',()=>{const r=evaluateSale({priceCents:10000,deliveryCents:10000,partner:true});assert.equal(r.commissionCents,0);assert.equal(r.distributable,false);});
test('Rate and margin dual-cap prevent payout beyond contribution budget',()=>{const r=evaluateSale({priceCents:10000,deliveryCents:5000,taxReserveRate:0,processingReserveRate:0,commissionMaxRate:0.9,partner:true});assert.equal(r.commissionCents,1750);});
test('Bad monetary inputs are rejected',()=>assert.throws(()=>evaluateSale({priceCents:-1,deliveryCents:20}),/Invalid/));
test('Bad proportion is rejected',()=>assert.throws(()=>evaluateSale({priceCents:100,deliveryCents:10,commissionMaxRate:1.5}),/Invalid rate/));
test('20-client mix is marked scenario, not actual sales',()=>{const r=forecastMix({growth_setup_40k:15,enterprise_setup_200k:5},{partnerShare:0.2});assert.equal(r.sales,20);assert.equal(r.turnoverCents,160_000_000);assert.equal(r.realOrdersObserved,0);assert.equal(r.realProfitVerified,false);});
test('Unknown SKU cannot enter published forecast',()=>assert.throws(()=>forecastMix({binary_recruitment_100k:40}),/Unknown product/));

test('CSV sample treats all tests as demos; no invented real revenue',()=>{const r=analyzeCsv(csv(row(),row({lead_id:'lead0002',qualified:'0',proposal_sent:'0',proposal_accepted:'0',paid_confirmed:'0',delivered:'0',client_accepted:'0',price_cents:'0',delivery_cents:'0',tax_cents:'0',fees_cents:'0',partner_commission_cents:'0'})));assert.equal(r.liveLeads,0);assert.equal(r.testLeadsExcluded,2);assert.equal(r.grossPaidCents,0);});
test('Real self-reported results separated from sandbox and never provider-verified',()=>{const r=analyzeCsv(csv(row({test_only:'0'}),row({lead_id:'lead0002'})));assert.equal(r.paidOrders,1);assert.equal(r.grossPaidCents,4_000_000);assert.equal(r.estimatedContributionCents,1_200_000);assert.equal(r.paymentsVerifiedExternally,false);});
test('Duplicate anonymous leads rejected',()=>assert.throws(()=>analyzeCsv(csv(row(),row())),/duplicated/));
test('Invalid column names / PII-containing headers rejected',()=>assert.throws(()=>analyzeCsv('email,phone,paid\na@b.com,123,1\n'),/header/));
test('Impossible funnel transition rejected',()=>assert.throws(()=>analyzeCsv(csv(row({proposal_accepted:'0',paid_confirmed:'1'}))),/Impossible/));
test('Unpaid lead with financial values rejected',()=>assert.throws(()=>analyzeCsv(csv(row({paid_confirmed:'0',delivered:'0',client_accepted:'0'}))),/Unpaid/));
test('Refund larger than sale rejected',()=>assert.throws(()=>analyzeCsv(csv(row({refund_cents:'4000001'}))),/Refund larger/));
test('Commission above 10% ceiling rejected',()=>assert.throws(()=>analyzeCsv(csv(row({partner_commission_cents:'500000'}))),/commission/i));
test('Properly escaped quoted CSV parses without raw ID in output',()=>{const text=csv(row({channel:'"walk-in, offline"',test_only:'0'})),r=analyzeCsv(text);assert.equal(r.liveLeads,1);assert(!JSON.stringify(r).includes('lead0001'));});
test('Blank CSV rejected',()=>assert.throws(()=>analyzeCsv(''),/Empty/));

clean('Demo launch gate refuses absent evidence by default',root=>{fixtureRepo(root);const r=evaluateLaunchGate({repository:root,stage:'demo',evidence:{nonCommercial:true}});assert.equal(r.decision,'NO_GO');assert(r.failures.some(x=>x.includes('backend')));});
clean('Demo gate passes only with three actual local hashed report files',root=>{fixtureRepo(root);const checks={};for(const k of ['backend','http','encryptedRestore'])checks[k]=record(root,k);const r=evaluateLaunchGate({repository:root,stage:'demo',evidence:{nonCommercial:true,checks}});assert.equal(r.decision,'LOCAL_DEMO_ONLY');assert.equal(r.approvedForRealPayments,false);});
clean('Any corrupted report turns local-demo GO back into NO_GO',root=>{fixtureRepo(root);const checks={};for(const k of ['backend','http','encryptedRestore'])checks[k]=record(root,k);writeFileSync(join(root,'http.log'),'TAMPERED');const r=evaluateLaunchGate({repository:root,stage:'demo',evidence:{nonCommercial:true,checks}});assert.equal(r.decision,'NO_GO');});
clean('Evidence paths cannot traverse outside approved evidence directory',root=>{fixtureRepo(root);const checks={backend:{status:'pass',file:'../outside.log',sha256:sha('PASS')}};const r=evaluateLaunchGate({repository:root,stage:'demo',evidence:{nonCommercial:true,checks}});assert.equal(r.checks.backend.pass,false);});
clean('Beta fails without full external staging evidence',root=>{fixtureRepo(root,{lock:true});const r=evaluateLaunchGate({repository:root,stage:'beta',evidence:{commitSha:'a'.repeat(40),nonCommercial:true}});assert.equal(r.decision,'NO_GO');assert(r.failures.some(x=>x.includes('browser')));});
clean('Paid gate never authorizes real money solely from user-supplied booleans',root=>{fixtureRepo(root,{lock:true});const r=evaluateLaunchGate({repository:root,stage:'paid',evidence:{realMoneyMode:true,legalApprovals:true,commitSha:'a'.repeat(40)}});assert.equal(r.decision,'NO_GO');assert.equal(r.approvedForRealPayments,false);});
clean('Claiming R13 without files always blocks launch',root=>{fixtureRepo(root);const r=evaluateLaunchGate({repository:root,stage:'beta',claim:'R13'});assert.equal(r.decision,'NO_GO');assert(r.failures.some(x=>x.includes('R13')));});
test('Unsupported launch gate stage rejects',()=>assert.throws(()=>evaluateLaunchGate({stage:'instant-million'}),/Stage/));

test('Subprocess helper returns success, disabled payment env and sanitizable summary',()=>{const s=runCheck(process.execPath,['-e',"if (process.env.PAYMENT_MODE!=='disabled'||process.env.PAYOUTS_ENABLED!=='0')process.exit(7);console.log('OK')"]);assert.equal(s.ok,true);assert(s.output.includes('OK'));});
test('Subprocess helper preserves nonzero exit as failure',()=>assert.equal(runCheck(process.execPath,['-e','process.exit(9)']).ok,false));
test('Subprocess helper stops stalled commands by timeout',()=>{const r=runCheck(process.execPath,['-e','setInterval(()=>{},1000)'],{timeoutMs:1500});assert.equal(r.ok,false);assert.equal(r.timeout,true);});
