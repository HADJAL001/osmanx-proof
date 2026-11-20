import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {openDatabase} from '../src/db.mjs';
import {createServices} from '../src/services.mjs';
import {createHttpServer} from '../src/server.mjs';
import {partner450Quote,PARTNER450_PRODUCTS,PARTNER450_TARGET} from '../src/partner450.mjs';

const ts='2026-11-20T07:00:00.000Z', proof='a'.repeat(64);
function fixture(){const db=openDatabase(':memory:');let time=ts;const svc=createServices(db,{clock:()=>time});
 let n=0;const register=(code='')=>{n++;const x=svc.createUser({name:`User ${n}`,email:`partner${n}@example.test`,password:'Passw0rd-is-long-unique',referralCode:code});return {id:x.user.id,org:x.orgId,code:db.prepare('SELECT code FROM referral_codes WHERE user_id=?').get(x.user.id).code};};
 const promoter=register(),buyer=register(promoter.code),admin=register();db.prepare('UPDATE users SET is_admin=1 WHERE id=?').run(admin.id);
 const issue=(p='growth_setup_40k')=>svc.partner450.createOrder(buyer.id,{orgId:buyer.org,packageId:p});
 const pay=(o,ext='sandbox_p450_abcdef123456')=>svc.partner450.processEvent({id:'evt_sandbox_'+ext,type:'payment.succeeded',provider:'SANDBOX_NO_REAL_MONEY',invoiceId:o.id,externalId:ext,amountCents:o.priceCents,currency:'RUB'},{sandbox:true});
 const refund=(ext,amount,paymentExternal='sandbox_p450_abcdef123456')=>svc.partner450.processEvent({id:'evt_refund_'+ext,type:'payment.refunded',provider:'SANDBOX_NO_REAL_MONEY',paymentExternalId:paymentExternal,externalId:ext,amountCents:amount},{sandbox:true});
 const close=()=>db.close();return {db,svc,register,promoter,buyer,admin,issue,pay,refund,close,setTime:t=>{time=t}};}
function run(fn){return ()=>{const f=fixture();try{return fn(f)}finally{f.close()}}}
const err=status=>e=>e.status===status;

test('R7 01: public catalogue has actual deliverables; no purchase required to join',run(f=>{
 const c=f.svc.partner450.catalog();assert.equal(c.target,450);assert.equal(c.requiresPurchaseToJoin,false);
 assert.equal(c.affiliateTiers,1);assert.equal(c.cashPayoutsEnabled,false);assert.equal(c.productionCheckoutEnabled,false);
 assert.equal(c.packages.length,2);assert(c.packages.every(p=>p.deliverables.length>=4));
 const wallet=f.svc.partner450.wallet(f.promoter.id);assert.equal(wallet.noPurchaseRequired,true);assert(wallet.code);
}));
test('R7 02: 10% gross but 35% pre-commission margin cap; no negative contribution',()=>{
 assert.equal(PARTNER450_TARGET,450);
 for(const p of PARTNER450_PRODUCTS){const q=partner450Quote(p);assert(q.rewardCents<=p.priceCents*0.10);
  assert(q.rewardCents<=Math.floor(q.estimatedPreCommissionContributionCents*.35));assert(q.postRewardContributionCents>=0)}
 assert.equal(partner450Quote(PARTNER450_PRODUCTS[0]).rewardCents,400000);
 assert.equal(partner450Quote(PARTNER450_PRODUCTS[1]).rewardCents,2000000);
});
test('R7 03: only owner may order and price is server-controlled',run(f=>{
 assert.throws(()=>f.svc.partner450.createOrder(f.promoter.id,{orgId:f.buyer.org,packageId:'growth_setup_40k'}),err(403));
 assert.throws(()=>f.svc.partner450.createOrder(f.buyer.id,{orgId:f.buyer.org,packageId:'invalid'}),err(422));
 const o=f.svc.partner450.createOrder(f.buyer.id,{orgId:f.buyer.org,packageId:'growth_setup_40k',amountCents:1});
 assert.equal(o.priceCents,4000000);assert.equal(o.status,'issued');
}));
test('R7 04: free user can refer paid buyer; does not need to buy a package',run(f=>{
 const o=f.issue();f.pay(o);const w=f.svc.partner450.wallet(f.promoter.id);
 assert.equal(w.rows.length,1);assert.equal(w.rows[0].amountCents,400000);
 assert.equal(f.svc.partner450.orders(f.buyer.id,f.buyer.org).length,1);
 assert.equal(f.svc.partner450.orders(f.promoter.id,f.promoter.org).length,0);
}));
test('R7 05: no commission on unpaid order; no money withdrawn',run(f=>{
 f.issue();assert.equal(f.svc.partner450.wallet(f.promoter.id).pendingCents,0);
 assert.equal(f.svc.partner450.wallet(f.promoter.id).availableForCashoutCents,0);
 assert.equal(f.svc.partner450.wallet(f.promoter.id).cashPayoutsEnabled,false);
}));
test('R7 06: simulation requires explicit sandbox flag and source prefix',run(f=>{
 const o=f.issue();const event={id:'evt_nosandbox1234',type:'payment.succeeded',provider:'SANDBOX_NO_REAL_MONEY',invoiceId:o.id,externalId:'sandbox_p450_some123',amountCents:o.priceCents,currency:'RUB'};
 assert.throws(()=>f.svc.partner450.processEvent(event),err(403));
 assert.throws(()=>f.svc.partner450.processEvent({...event,externalId:'pi_fake45678'},{sandbox:true}),err(403));
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM partner450_payments').get().n,0);
}));
test('R7 07: reject forged, mismatched amount and currency with rollback',run(f=>{
 const o=f.issue();f.svc.partner450.bindTestIntent(f.buyer.id,o.id,'pi_legitimate001');
 for(const overrides of [{externalId:'pi_wrong123456'},{amountCents:o.priceCents-1},{currency:'USD'},{provider:'STRIPE_LIVE'}]){
  const e={id:'evt_test_wrong_'+Math.random().toString().slice(2),type:'payment.succeeded',provider:'STRIPE_TEST',invoiceId:o.id,externalId:'pi_legitimate001',amountCents:o.priceCents,currency:'RUB',...overrides};
  assert.throws(()=>f.svc.partner450.processEvent(e),x=>[403,409].includes(x.status));
 }
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM partner450_events').get().n,0);
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM partner450_payments').get().n,0);
}));
test('R7 08: intent binding idempotent, no replacement or cross-account binding',run(f=>{
 const o=f.issue();assert.throws(()=>f.svc.partner450.bindTestIntent(f.promoter.id,o.id,'pi_buyer123456'),err(403));
 assert.equal(f.svc.partner450.bindTestIntent(f.buyer.id,o.id,'pi_buyer123456').testOnly,true);
 f.svc.partner450.bindTestIntent(f.buyer.id,o.id,'pi_buyer123456');
 assert.throws(()=>f.svc.partner450.bindTestIntent(f.buyer.id,o.id,'pi_other99999'),err(409));
}));
test('R7 09: duplicate signed Stripe TEST event is idempotent and ledger balances',run(f=>{
 const o=f.issue();f.svc.partner450.bindTestIntent(f.buyer.id,o.id,'pi_testpartner00001');
 const e={id:'evt_testpartner00001',type:'payment.succeeded',provider:'STRIPE_TEST',invoiceId:o.id,externalId:'pi_testpartner00001',amountCents:o.priceCents,currency:'RUB'};
 assert.equal(f.svc.partner450.processEvent(e).duplicate,false);
 assert.equal(f.svc.partner450.processEvent(e).duplicate,true);
 assert.throws(()=>f.svc.partner450.processEvent({...e,amountCents:1}),err(409));
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM partner450_payments').get().n,1);
 assert.equal(f.svc.verifyLedger().ok,true);assert.equal(f.svc.verifyAudit().ok,true);
}));
test('R7 10: a second package from same buyer cannot produce another commission',run(f=>{
 const a=f.issue();f.pay(a);const b=f.issue('enterprise_setup_200k');
 f.pay(b,'sandbox_p450_second_sale123');
 assert.equal(f.db.prepare('SELECT COUNT(*) n FROM partner450_commissions').get().n,1);
 assert.equal(f.svc.partner450.wallet(f.promoter.id).rows.length,1);
}));
test('R7 11: self-attribution is structurally impossible',run(f=>{
 assert.throws(()=>f.db.prepare('INSERT INTO referral_attributions(buyer_id,referrer_id,code,created_at) VALUES(?,?,?,?)')
  .run(f.promoter.id,f.promoter.id,'BAD',ts));
}));
test('R7 12: delivery requires admin and independent buyer evidence',run(f=>{
 const o=f.issue();f.pay(o);
 assert.throws(()=>f.svc.partner450.deliver(f.promoter.id,o.id,{summary:'Delivered a configured business workspace and training',evidenceSha256:proof}),err(403));
 assert.throws(()=>f.svc.partner450.deliver(f.admin.id,o.id,{summary:'short',evidenceSha256:proof}),err(422));
 assert.throws(()=>f.svc.partner450.deliver(f.admin.id,o.id,{summary:'Delivered a configured workspace and training',evidenceSha256:'bad'}),err(422));
 const d=f.svc.partner450.deliver(f.admin.id,o.id,{summary:'Delivered a configured workspace and training',evidenceSha256:proof});
 assert.equal(d.status,'delivered');assert.equal(d.deliveryProofHash,proof);
}));
test('R7 13: authenticated buyer acceptance gives tamper-checkable receipt, not a legal signature',run(f=>{
 const o=f.issue();f.pay(o);
 f.svc.partner450.deliver(f.admin.id,o.id,{summary:'Delivered a configured workspace and training',evidenceSha256:proof});
 assert.throws(()=>f.svc.partner450.accept(f.promoter.id,o.id,{accepted:true}),err(403));
 assert.throws(()=>f.svc.partner450.accept(f.buyer.id,o.id,{accepted:false}),err(422));
 const a=f.svc.partner450.accept(f.buyer.id,o.id,{accepted:true});
 assert.match(a.receiptHash,/^[a-f0-9]{64}$/);assert.equal(a.legalSignature,false);
 assert.throws(()=>f.svc.partner450.accept(f.buyer.id,o.id,{accepted:true}),err(409));
}));
test('R7 14: no release before fulfillment and hold period',run(f=>{
 const o=f.issue();f.pay(o);f.setTime('2026-12-11T00:00:00.000Z');
 assert.equal(f.svc.partner450.settle(f.admin.id).testEligible,0);
 const d=f.svc.partner450.deliver(f.admin.id,o.id,{summary:'Delivered a configured workspace and training',evidenceSha256:proof});
 f.svc.partner450.accept(f.buyer.id,o.id,{accepted:true});
 assert.equal(f.svc.partner450.settle(f.admin.id).testEligible,1);
 assert.equal(f.svc.partner450.wallet(f.promoter.id).testEligibleCents,400000);
 assert.equal(f.svc.partner450.wallet(f.promoter.id).availableForCashoutCents,0);
}));
test('R7 15: risk flags prevent release until cleared',run(f=>{
 const o=f.issue();f.pay(o);f.svc.partner450.deliver(f.admin.id,o.id,{summary:'Delivered a configured workspace and training',evidenceSha256:proof});
 f.svc.partner450.accept(f.buyer.id,o.id,{accepted:true});f.setTime('2026-12-11T00:00:00.000Z');
 f.db.prepare('INSERT INTO fraud_flags(id,buyer_id,referrer_id,kind,reason,status,created_at) VALUES(?,?,?,?,?,?,?)').run('risk450',f.buyer.id,f.promoter.id,'review','Risk for test','open',ts);
 assert.equal(f.svc.partner450.settle(f.admin.id).testEligible,0);
 f.db.prepare('UPDATE fraud_flags SET status=? WHERE id=?').run('cleared','risk450');
 assert.equal(f.svc.partner450.settle(f.admin.id).testEligible,1);
}));
test('R7 16: partial refund shrinks commission and voids eligibility',run(f=>{
 const o=f.issue();f.pay(o);const x=f.refund('re_part4500001',2_000_000);
 assert.equal(x.status,'part_refunded');assert.equal(f.svc.partner450.wallet(f.promoter.id).pendingCents,200000);
 assert.equal(f.svc.partner450.wallet(f.promoter.id).testEligibleCents,0);
 assert.equal(f.svc.verifyLedger().ok,true);
}));
test('R7 17: full refund reverses commission and repeated refund rejected',run(f=>{
 const o=f.issue();f.pay(o);f.refund('re_all4500001',4_000_000);
 assert.equal(f.svc.partner450.wallet(f.promoter.id).pendingCents,0);
 assert.equal(f.svc.partner450.wallet(f.promoter.id).rows[0].status,'void');
 assert.throws(()=>f.refund('re_all4500002',1),err(422));
 assert.equal(f.svc.verifyLedger().ok,true);
}));
test('R7 18: paid revenue is not calculated from invited registrations alone',run(f=>{
 f.register(f.promoter.code);f.register(f.promoter.code);
 const w=f.svc.partner450.wallet(f.promoter.id);assert.equal(w.completedSales,0);
 assert.equal(w.progressPercent,0);assert.equal(w.rows.length,0);
}));
test('R7 19: ownership and tenant isolation prevent cross-account reads',run(f=>{
 const o=f.issue();assert.throws(()=>f.svc.partner450.details(f.promoter.id,o.id),err(403));
 assert.throws(()=>f.svc.partner450.orders(f.promoter.id,f.buyer.org),err(403));
 assert.equal(f.svc.partner450.adminOrders(f.admin.id).length,1);
 assert.throws(()=>f.svc.partner450.adminOrders(f.buyer.id),err(403));
}));
test('R7 20: test eligibility repeated settlement is idempotent and never a payout',run(f=>{
 const o=f.issue();f.pay(o);f.svc.partner450.deliver(f.admin.id,o.id,{summary:'Delivered a configured workspace and training',evidenceSha256:proof});
 f.svc.partner450.accept(f.buyer.id,o.id,{accepted:true});f.setTime('2026-12-11T00:00:00.000Z');
 assert.equal(f.svc.partner450.settle(f.admin.id).testEligible,1);
 assert.equal(f.svc.partner450.settle(f.admin.id).testEligible,0);
 assert.equal(f.svc.partner450.wallet(f.promoter.id).availableForCashoutCents,0);
}));

// Full network protocol: public catalogue, CSRF, tenant isolation, signed Stripe TEST webhook and real source mapping.
async function httpFixture(mode='sandbox'){
 const db=openDatabase(':memory:'),stripeSecret='whsec_r7_partner450_webhook_secret_123',key='sk_test_r7_partner450_credential_abc',
 fetchFn=async(url,opts)=>({ok:true,json:async()=>({id:'pi_r7_purchase00001',amount:Number(opts.body.get('amount')),
  currency:'rub',metadata:{osx_invoice_id:opts.body.get('metadata[osx_invoice_id]')},client_secret:'pi_r7_client_secret_123',livemode:false})});
 const app=createHttpServer({db,mode,origin:'https://proof.example',production:false,stripeWebhookSecret:stripeSecret,stripeSecretKey:key,stripeFetch:fetchFn});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${app.server.address().port}`;
 const req=async(path,{method='GET',body,actor,headers={}}={})=>{
  const response=await fetch(base+path,{method,headers:{origin:'https://proof.example',...(body?{'content-type':'application/json'}:{}),...(actor?{cookie:actor.cookie,'x-csrf-token':actor.csrf}:{}),...headers},body:body?JSON.stringify(body):undefined});
  const contentType=response.headers.get('content-type')||'';
  return {status:response.status,data:contentType.includes('json')?await response.json():await response.text(),cookie:response.headers.get('set-cookie')?.split(';')[0]};
 };
 let i=0;const register=async(code)=>{i++;const r=await req('/api/auth/register',{method:'POST',body:{name:`Test Actor ${i}`,email:`actor450_${i}@sample.invalid`,password:'A_password_with_10_chars',referralCode:code||''}});
  assert.equal(r.status,201,JSON.stringify(r.data));return {id:r.data.user.id,org:r.data.organizations[0].id,csrf:r.data.csrf,cookie:r.cookie};};
 return {db,app,base,req,register,webhook:async ev=>{const raw=JSON.stringify(ev),t=Math.floor(Date.now()/1000),sig=createHmac('sha256',stripeSecret).update(t+'.'+raw).digest('hex');
  const response=await fetch(base+'/api/webhooks/stripe-test',{method:'POST',headers:{'stripe-signature':`t=${t},v1=${sig}`},body:raw});return {status:response.status,data:await response.json()};},
 close:async()=>{await new Promise(r=>app.server.close(r));db.close()}};
}
const httpTest=(name,mode,fn)=>test(name,async()=>{const f=await httpFixture(mode);try{await fn(f)}finally{await f.close()}});
httpTest('R7 HTTP 21: catalogue is public, purchase not required for free affiliate link','sandbox',async f=>{
 const c=await f.req('/api/partner450/catalog');assert.equal(c.status,200);assert.equal(c.data.requiresPurchaseToJoin,false);
 const promoter=await f.register();const w=await f.req('/api/partner450/me',{actor:promoter});assert.equal(w.status,200);
 assert.match(w.data.referralUrl,/\?ref=/);assert.equal(w.data.cashPayoutsEnabled,false);
});
httpTest('R7 HTTP 22: order creation requires session, valid CSRF and matching owner','sandbox',async f=>{
 const buyer=await f.register(),attacker=await f.register();const b={orgId:buyer.org,packageId:'growth_setup_40k'};
 assert.equal((await f.req('/api/partner450/orders',{method:'POST',body:b})).status,401);
 assert.equal((await f.req('/api/partner450/orders',{method:'POST',body:b,headers:{cookie:buyer.cookie}})).status,403);
 assert.equal((await f.req('/api/partner450/orders',{method:'POST',body:b,actor:attacker})).status,403);
 const created=await f.req('/api/partner450/orders',{method:'POST',body:b,actor:buyer});assert.equal(created.status,201);
 assert.equal(created.data.order.priceCents,4_000_000);
});
httpTest('R7 HTTP 23: explicit sandbox payment never yields actual withdrawable money','sandbox',async f=>{
 const promoter=await f.register();const code=(await f.req('/api/partner450/me',{actor:promoter})).data.code;
 const buyer=await f.register(code);const o=(await f.req('/api/partner450/orders',{method:'POST',body:{orgId:buyer.org,packageId:'growth_setup_40k'},actor:buyer})).data.order;
 assert.equal((await f.req(`/api/partner450/orders/${o.id}/sandbox-pay`,{method:'POST',body:{},actor:promoter})).status,403);
 const pay=await f.req(`/api/partner450/orders/${o.id}/sandbox-pay`,{method:'POST',body:{},actor:buyer});assert.equal(pay.status,200);
 const w=await f.req('/api/partner450/me',{actor:promoter});assert.equal(w.data.pendingCents,400000);
 assert.equal(w.data.availableForCashoutCents,0);
});
httpTest('R7 HTTP 24: stripe webhook cannot credit unbound intent or wrong amount','stripe_test',async f=>{
 const promoter=await f.register();const code=(await f.req('/api/partner450/me',{actor:promoter})).data.code;const buyer=await f.register(code);
 const o=(await f.req('/api/partner450/orders',{method:'POST',body:{orgId:buyer.org,packageId:'growth_setup_40k'},actor:buyer})).data.order;
 const stripe=(id,externalId='pi_r7_purchase00001',amount=4_000_000)=>({id,type:'payment_intent.succeeded',livemode:false,data:{object:{object:'payment_intent',id:externalId,amount_received:amount,
  currency:'rub',status:'succeeded',metadata:{osx_invoice_id:o.id}}}});
 assert.equal((await f.webhook(stripe('evt_r7_unbound_001'))).status,409);
 const intent=await f.req(`/api/partner450/orders/${o.id}/intent`,{method:'POST',body:{},actor:buyer});assert.equal(intent.status,200);
 assert.equal((await f.webhook(stripe('evt_r7_mismatch_001','pi_fake00002'))).status,409);
 const paid=await f.webhook(stripe('evt_r7_paid_realtest_001'));assert.equal(paid.status,200);
 assert.equal((await f.webhook(stripe('evt_r7_paid_realtest_001'))).data.duplicate,true);
 assert.equal((await f.req('/api/partner450/me',{actor:promoter})).data.pendingCents,400000);
});
httpTest('R7 HTTP 25: signed Stripe live event rejected and cross-origin call blocked','stripe_test',async f=>{
 const buyer=await f.register();const o=(await f.req('/api/partner450/orders',{method:'POST',body:{orgId:buyer.org,packageId:'growth_setup_40k'},actor:buyer})).data.order;
 const bad={id:'evt_r7_live_reject1',type:'payment_intent.succeeded',livemode:true,data:{object:{object:'payment_intent',id:'pi_bad_test001',amount_received:4_000_000,currency:'rub',status:'succeeded',metadata:{osx_invoice_id:o.id}}}};
 assert.equal((await f.webhook(bad)).status,422);
 const blocked=await f.req('/api/partner450/orders',{method:'POST',body:{orgId:buyer.org,packageId:'growth_setup_40k'},actor:buyer,headers:{origin:'https://evil.example'}});
 assert.equal(blocked.status,403);
});
