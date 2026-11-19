import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db.mjs';
import { createServices } from '../src/services.mjs';
import { quoteMath, invoicePrice, calculateReward, ledgerBalanced } from '../src/finance.mjs';
import { passwordHash, verifyPassword, signWebhook, verifyWebhook } from '../src/security.mjs';

function fixture(){
 let time=Date.parse('2026-11-19T12:00:00.000Z');
 const db=openDatabase(':memory:');const svc=createServices(db,{clock:()=>new Date(time).toISOString()});
 const create=(name,referralCode='',ipHash=null)=>svc.createUser({name,email:`${name.toLowerCase().replace(/\s/g,'')}@example.org`,password:'SomeStrongPassword123!',referralCode,ipHash});
 const advance=days=>time+=days*86400000;
 const payment=(invoice)=>svc.processPaymentEvent({id:'pay_event_'+crypto.randomUUID(),type:'payment.succeeded',invoiceId:invoice.id,provider:'SANDBOX',externalId:'external_payment_'+crypto.randomUUID(),amountCents:invoice.total_cents,currency:'RUB'});
 const refund=(pay,amount)=>svc.processPaymentEvent({id:'ref_event_'+crypto.randomUUID(),type:'payment.refunded',paymentExternalId:pay.external_id,provider:'SANDBOX',externalId:'external_refund_'+crypto.randomUUID(),amountCents:amount});
 return {db,svc,create,advance,payment,refund,close:()=>db.close()};
}
const item={description:'Website design',qty:2,unitPriceCents:10000,unitCostCents:4000};
const quote={title:'Development',clientName:'Company',items:[item],discountCents:1000,taxBps:2000};

test('1. password hashing uses salted scrypt and rejects incorrect password',()=>{
 const a=passwordHash('GoodPassword122!'),b=passwordHash('GoodPassword122!');assert.notEqual(a,b);
 assert.equal(verifyPassword('GoodPassword122!',a),true);assert.equal(verifyPassword('WrongPassword!',a),false);
});
test('2. registration creates tenant, membership, and unique referral code',()=>{
 const f=fixture();try{
 const a=f.create('Alice');assert.equal(f.svc.orgs(a.user.id)[0].role,'owner');
 const b=f.create('Bob');assert.notEqual(f.svc.rewards(a.user.id).code,f.svc.rewards(b.user.id).code);
 assert.equal(f.svc.verifyAudit().ok,true);
 }finally{f.close()}
});
test('3. duplicate registration rejected; weak password rejected',()=>{
 const f=fixture();try{
 f.create('Alice');assert.throws(()=>f.create('Alice'),e=>e.status===409);
 assert.throws(()=>f.svc.createUser({name:'Bad',email:'bad@e.io',password:'short'}),e=>e.status===422);
 }finally{f.close()}
});
test('4. session cookie token hashes are stored and logout revokes access',()=>{
 const f=fixture();try{
 const a=f.create('Alice'),s=f.svc.createSession(a.user.id);
 assert.equal(f.svc.getSession(s.secret).user.id,a.user.id);
 assert.equal(f.db.prepare('SELECT token_hash FROM sessions').get().token_hash===s.secret,false);
 f.svc.revokeSession(s.secret,a.user.id);assert.equal(f.svc.getSession(s.secret),null);
 }finally{f.close()}
});
test('5. memberships prevent cross-tenant quote reads or writes',()=>{
 const f=fixture();try{
 const a=f.create('Alice'),b=f.create('Bob');const q=f.svc.createQuote(a.user.id,a.orgId,quote);
 assert.throws(()=>f.svc.getQuote(b.user.id,q.id),e=>e.status===403);
 assert.throws(()=>f.svc.createQuote(b.user.id,a.orgId,quote),e=>e.status===403);
 }finally{f.close()}
});
test('6. invitation enforces matching email, role, one-time acceptance',()=>{
 const f=fixture();try{
 const a=f.create('Alice'),b=f.create('Bob'),c=f.create('Cora');
 const invite=f.svc.invite(a.user.id,a.orgId,b.user.email,'editor');
 assert.throws(()=>f.svc.acceptInvite(c.user.id,invite.token),e=>e.status===403);
 assert.equal(f.svc.acceptInvite(b.user.id,invite.token).role,'editor');
 assert.throws(()=>f.svc.acceptInvite(b.user.id,invite.token),e=>e.status===403);
 assert.ok(f.svc.createQuote(b.user.id,a.orgId,quote));
 assert.throws(()=>f.svc.invite(b.user.id,a.orgId,c.user.email,'viewer'),e=>e.status===403);
 }finally{f.close()}
});
test('7. quote math calculates discount, tax and margins in integer cents',()=>{
 const x=quoteMath([item],1000,2000);
 assert.equal(x.subtotalCents,20000);assert.equal(x.costCents,8000);assert.equal(x.taxCents,3800);
 assert.equal(x.totalCents,22800);assert.equal(x.estimatedProfitCents,11000);
 assert.equal(x.estimatedMarginPercent,57.89);
});
test('8. invalid quote quantities and over-discounts rejected',()=>{
 assert.throws(()=>quoteMath([{...item,qty:0}]),e=>e.status===422);
 assert.throws(()=>quoteMath([item],30000),e=>e.status===422);
 assert.throws(()=>quoteMath(Array.from({length:20},()=>({...item,unitPriceCents:100000000000,qty:10000}))),e=>e.status===422);
});
test('9. free plan limits creation to 3 quotes per UTC month',()=>{
 const f=fixture();try{
 const a=f.create('Alice');for(let i=0;i<3;i++)f.svc.createQuote(a.user.id,a.orgId,{...quote,title:'Job '+i});
 assert.throws(()=>f.svc.createQuote(a.user.id,a.orgId,{...quote,title:'Job four'}),e=>e.status===402);
 f.advance(40);assert.ok(f.svc.createQuote(a.user.id,a.orgId,{...quote,title:'New month'}));
 }finally{f.close()}
});
test('10. accepted quotes cannot be silently overwritten',()=>{
 const f=fixture();try{
 const a=f.create('Alice'),q=f.svc.createQuote(a.user.id,a.orgId,quote);
 f.svc.quoteStatus(a.user.id,q.id,'sent');f.svc.quoteStatus(a.user.id,q.id,'accepted');
 assert.throws(()=>f.svc.updateQuote(a.user.id,q.id,quote),e=>e.status===409);
 }finally{f.close()}
});
test('11. expiring share token gives view, no cost or email data through page',()=>{
 const f=fixture();try{
 const a=f.create('Alice'),q=f.svc.createQuote(a.user.id,a.orgId,{...quote,clientEmail:'client@private.test'});
 const share=f.svc.shareQuote(a.user.id,q.id);const read=f.svc.quoteByShare(share.token);
 assert.equal(read.clientEmail,'');assert.equal(read.math.totalCents,q.math.totalCents);
 f.advance(15);assert.throws(()=>f.svc.quoteByShare(share.token),e=>e.status===404);
 }finally{f.close()}
});
test('12. invoice prices are server-calculated with no referral signup payment',()=>{
 assert.deepEqual(invoicePrice(false),{listAmountCents:129000,discountCents:0,totalCents:129000});
 assert.deepEqual(invoicePrice(true),{listAmountCents:129000,discountCents:12900,totalCents:116100});
 const f=fixture();try{
 const a=f.create('Alice'),b=f.create('Bob',f.svc.rewards(a.user.id).code);
 const i=f.svc.createInvoice(b.user.id,b.orgId);assert.equal(i.total_cents,116100);assert.equal(f.svc.rewards(a.user.id).totalCents,0);
 assert.equal(f.svc.createInvoice(b.user.id,b.orgId).id,i.id);
 }finally{f.close()}
});
test('13. signed HMAC webhooks enforce timestamp and correct signature',()=>{
 const secret='LongSecretForPaymentBridgeMustBeAtLeast32Chars',body='{"id":"event_12345"}',stamp=String(Math.floor(Date.now()/1000));
 const sig=signWebhook(body,stamp,secret);
 assert.equal(verifyWebhook(body,stamp,sig,secret),true);
 assert.equal(verifyWebhook(body+'x',stamp,sig,secret),false);
 assert.equal(verifyWebhook(body,String(Number(stamp)-1000),sig,secret),false);
});
test('14. payment refuses mismatched amount and leaves invoice unpaid',()=>{
 const f=fixture();try{
 const a=f.create('Alice'),i=f.svc.createInvoice(a.user.id,a.orgId);
 assert.throws(()=>f.svc.processPaymentEvent({id:'event_wrongamount',type:'payment.succeeded',invoiceId:i.id,provider:'TEST',externalId:'gateway_pay_1',amountCents:1,currency:'RUB'}),e=>e.status===422);
 assert.equal(f.svc.invoices(a.user.id,a.orgId)[0].status,'issued');assert.equal(f.svc.verifyLedger().transactions,0);
 }finally{f.close()}
});
test('15. confirmed payment activates Pro and allows more proposals',()=>{
 const f=fixture();try{
 const a=f.create('Alice');for(let i=0;i<3;i++)f.svc.createQuote(a.user.id,a.orgId,{...quote,title:'Site '+i});
 const inv=f.svc.createInvoice(a.user.id,a.orgId);f.payment(inv);
 assert.equal(f.svc.isPro(a.orgId),true);
 assert.ok(f.svc.createQuote(a.user.id,a.orgId,{...quote,title:'Site 4'}));
 assert.equal(f.svc.verifyLedger().ok,true);
 }finally{f.close()}
});
test('16. duplicate payment events idempotent and event ID collisions rejected',()=>{
 const f=fixture();try{
 const a=f.create('Alice'),i=f.svc.createInvoice(a.user.id,a.orgId);
 const e={id:'event_12345',type:'payment.succeeded',invoiceId:i.id,provider:'TEST',externalId:'ext-pay-123456',amountCents:i.total_cents,currency:'RUB'};
 assert.equal(f.svc.processPaymentEvent(e).duplicate,false);
 assert.equal(f.svc.processPaymentEvent(e).duplicate,true);
 assert.throws(()=>f.svc.processPaymentEvent({...e,externalId:'tampered-pay-789'}),x=>x.status===409);
 assert.equal(f.svc.verifyLedger().transactions,1);
 }finally{f.close()}
});
test('17. signup alone never earns rewards; first real paid month earns one reward',()=>{
 const f=fixture();try{
 const a=f.create('Alice'),b=f.create('Bob',f.svc.rewards(a.user.id).code);
 assert.equal(f.svc.rewards(a.user.id).totalCents,0);
 const first=f.svc.createInvoice(b.user.id,b.orgId);f.payment(first);
 assert.equal(f.svc.rewards(a.user.id).totalCents,11610);
 const second=f.svc.createInvoice(b.user.id,b.orgId);assert.equal(second.discount_cents,0);f.payment(second);
 assert.equal(f.svc.rewards(a.user.id).rows.length,1);
 assert.equal(f.svc.verifyLedger().ok,true);
 }finally{f.close()}
});
test('18. first-sale reward cap respects contribution and policy limit',()=>{
 assert.equal(calculateReward(116100),11610);
 assert.equal(calculateReward(1000),0);
 assert.ok(calculateReward(10_000_000)<=25000);
});
test('19. full refund reverses subscription and referral liability',()=>{
 const f=fixture();try{
 const a=f.create('Alice'),b=f.create('Bob',f.svc.rewards(a.user.id).code);
 const i=f.svc.createInvoice(b.user.id,b.orgId);f.payment(i);const p=f.db.prepare('SELECT * FROM payments').get();
 f.refund(p,p.amount_cents);assert.equal(f.svc.isPro(b.orgId),false);
 assert.equal(f.svc.rewards(a.user.id).rows[0].status,'void');assert.equal(f.svc.rewards(a.user.id).totalCents,0);
 assert.equal(f.svc.verifyLedger().ok,true);
 }finally{f.close()}
});
test('20. partial refunds reduce reward without negative balances',()=>{
 const f=fixture();try{
 const a=f.create('Alice'),b=f.create('Bob',f.svc.rewards(a.user.id).code);const i=f.svc.createInvoice(b.user.id,b.orgId);f.payment(i);
 const p=f.db.prepare('SELECT * FROM payments').get();f.refund(p,50000);
 assert.equal(f.svc.rewards(a.user.id).totalCents,calculateReward(66100));
 assert.throws(()=>f.refund(p,100000),e=>e.status===409);
 assert.equal(f.svc.verifyLedger().ok,true);
 }finally{f.close()}
});
test('21. shared network flagged for manual review before reward becomes payable',()=>{
 const f=fixture();try{
 const a=f.create('Alice','', 'ipABC'),b=f.create('Bob',f.svc.rewards(a.user.id).code,'ipABC');
 const i=f.svc.createInvoice(b.user.id,b.orgId);f.payment(i);f.advance(16);f.svc.setAdmin(a.user.email);
 assert.equal(f.svc.settleRewards(a.user.id).settled,0);
 const fraud=f.svc.adminLists(a.user.id).fraud[0];f.svc.reviewFraud(a.user.id,fraud.id,'cleared');
 assert.equal(f.svc.settleRewards(a.user.id).settled,1);assert.equal(f.svc.rewards(a.user.id).payableCents,11610);
 }finally{f.close()}
});
test('22. payout requests reserve earned amount and do not pretend to transfer funds',()=>{
 const f=fixture();try{
 const a=f.create('Alice'),b=f.create('Bob',f.svc.rewards(a.user.id).code),i=f.svc.createInvoice(b.user.id,b.orgId);
 f.payment(i);f.advance(16);f.svc.setAdmin(a.user.email);f.svc.settleRewards(a.user.id);
 const r=f.svc.requestPayout(a.user.id,10000);assert.equal(r.status,'requested');
 assert.match(r.warning,/No payout provider/);
 assert.throws(()=>f.svc.requestPayout(a.user.id,10000),e=>e.status===422);
 assert.equal(f.svc.reviewPayout(a.user.id,r.id,'approved').status,'approved');
 assert.equal(f.svc.payoutRequests(a.user.id)[0].status,'approved');
 }finally{f.close()}
});
test('23. audit chain catches tampering and ledger detects imbalance',()=>{
 const f=fixture();try{
 const a=f.create('Alice'),i=f.svc.createInvoice(a.user.id,a.orgId);f.payment(i);
 assert.equal(f.svc.verifyAudit().ok,true);assert.equal(f.svc.verifyLedger().ok,true);
 f.db.exec("UPDATE audit_events SET metadata_json='hacked' WHERE seq=1");assert.equal(f.svc.verifyAudit().ok,false);
 f.db.exec('UPDATE ledger_entries SET debit_cents=debit_cents+1 WHERE debit_cents>0');assert.equal(f.svc.verifyLedger().ok,false);
 }finally{f.close()}
});
test('24. only admin may access global dashboard and moderate cases',()=>{
 const f=fixture();try{
 const a=f.create('Alice'),b=f.create('Bob');assert.throws(()=>f.svc.adminDashboard(a.user.id),e=>e.status===403);
 f.svc.setAdmin(b.user.email);assert.equal(f.svc.adminDashboard(b.user.id).users,2);
 const ticket=f.svc.createDispute(a.user.id,a.orgId,'Please review','I need an invoice correction.');
 assert.equal(f.svc.reviewDispute(b.user.id,ticket.id,'resolved','Reviewed and resolved').status,'resolved');
 }finally{f.close()}
});
test('25. ledger utility rejects unbalanced or malformed entries',()=>{
 assert.equal(ledgerBalanced([{debitCents:100,creditCents:0},{debitCents:0,creditCents:100}]),true);
 assert.equal(ledgerBalanced([{debitCents:100,creditCents:0},{debitCents:0,creditCents:99}]),false);
 assert.equal(ledgerBalanced([{debitCents:100,creditCents:2},{debitCents:0,creditCents:102}]),false);
});
test('26. first-purchase referral discount cannot be duplicated across organizations',()=>{
 const f=fixture();try{
 const a=f.create('Alice'),b=f.create('Bob',f.svc.rewards(a.user.id).code);
 const i1=f.svc.createInvoice(b.user.id,b.orgId);const newOrg=f.svc.createOrganization(b.user.id,'Second company');
 const i2=f.svc.createInvoice(b.user.id,newOrg);
 assert.equal(i1.discount_cents,12900);assert.equal(i2.discount_cents,0);
 }finally{f.close()}
});
test('27. refund revokes unsupported reserved payout requests',()=>{
 const f=fixture();try{
 const a=f.create('Alice'),b=f.create('Bob',f.svc.rewards(a.user.id).code),i=f.svc.createInvoice(b.user.id,b.orgId);
 f.payment(i);f.advance(16);f.svc.setAdmin(a.user.email);f.svc.settleRewards(a.user.id);
 const pay=f.svc.requestPayout(a.user.id,10000);f.svc.reviewPayout(a.user.id,pay.id,'approved');
 const p=f.db.prepare('SELECT * FROM payments').get();f.refund(p,p.amount_cents);
 assert.equal(f.svc.payoutRequests(a.user.id)[0].status,'rejected');assert.equal(f.svc.verifyLedger().ok,true);
 }finally{f.close()}
});
test('28. holding period keeps referral reward pending until 14 days expire',()=>{
 const f=fixture();try{
 const a=f.create('Alice'),b=f.create('Bob',f.svc.rewards(a.user.id).code),i=f.svc.createInvoice(b.user.id,b.orgId);
 f.payment(i);f.svc.setAdmin(a.user.email);f.advance(13);
 assert.equal(f.svc.settleRewards(a.user.id).settled,0);
 f.advance(2);assert.equal(f.svc.settleRewards(a.user.id).settled,1);
 }finally{f.close()}
});
test('29. viewer role has read access but cannot edit quotes',()=>{
 const f=fixture();try{
 const a=f.create('Alice'),b=f.create('Bob');const q=f.svc.createQuote(a.user.id,a.orgId,quote);
 const invite=f.svc.invite(a.user.id,a.orgId,b.user.email,'viewer');f.svc.acceptInvite(b.user.id,invite.token);
 assert.equal(f.svc.getQuote(b.user.id,q.id).id,q.id);
 assert.throws(()=>f.svc.updateQuote(b.user.id,q.id,quote),e=>e.status===403);
 }finally{f.close()}
});

test('30. creating another free organization cannot bypass monthly quote quota',()=>{
 const f=fixture();try{
  const a=f.create('Alice');for(let i=0;i<3;i++)f.svc.createQuote(a.user.id,a.orgId,{...quote,title:'Site '+i});
  const secondOrg=f.svc.createOrganization(a.user.id,'Extra free workspace');
  assert.throws(()=>f.svc.createQuote(a.user.id,secondOrg,quote),e=>e.status===402);
 }finally{f.close()}
});
