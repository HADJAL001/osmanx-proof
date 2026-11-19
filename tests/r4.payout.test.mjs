import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {openDatabase} from '../src/db.mjs';
import {createServices} from '../src/services.mjs';
import {createHttpServer} from '../src/server.mjs';
import {deliverVerificationEmail} from '../src/email-delivery.mjs';
const throws=(f,status)=>assert.throws(f,e=>e.status===status);
function fixture(){
 let t=Date.parse('2026-11-20T10:00:00.000Z');
 const db=openDatabase(':memory:'),svc=createServices(db,{clock:()=>new Date(t).toISOString()});
 const add=(name)=>svc.createUser({name,email:name.toLowerCase()+'@r4.test',password:'strong-password-2026-abc'});
 const recipient=add('Recipient'),buyer=svc.createUser({name:'Buyer',email:'buyer@r4.test',password:'strong-password-2026-abc',referralCode:svc.rewards(recipient.user.id).code});
 const a=add('AdminA'),b=add('AdminB'),c=add('AdminC');for(const x of [a,b,c])svc.setAdmin(x.user.email);
 const invoice=svc.createInvoice(buyer.user.id,buyer.orgId);
 svc.processPaymentEvent({id:'r4_payout_event_001',type:'payment.succeeded',invoiceId:invoice.id,externalId:'r4_payout_payment_001',provider:'TEST',amountCents:invoice.total_cents,currency:'RUB'});
 t+=15*86400000;svc.settleRewards(a.user.id);
 const payout=svc.requestPayout(recipient.user.id,svc.rewards(recipient.user.id).availableCents);
 const ready=()=>{
  svc.reviewPayout(a.user.id,payout.id,'approved');
  const v=svc.verificationChallenge(recipient.user.id,{testMode:true});svc.confirmEmailChallenge(v.testToken);
  svc.acceptLegalTerms(recipient.user.id,{document:'referral_terms',version:'2026-11',accepted:true});
  svc.requestIdentityReview(recipient.user.id);svc.reviewIdentity(a.user.id,recipient.user.id,'approved');
  svc.preparePayout(b.user.id,payout.id);
 };
 return {db,svc,recipient,buyer,a,b,c,invoice,payout,ready,advance:d=>t+=d*86400000,close:()=>db.close()};
}
test('R4 PAYOUT 01: tax declaration validates country, taxpayer type and confirmation',()=>{
 const f=fixture();try{const id=f.recipient.user.id;
 throws(()=>f.svc.taxAttestation(id,{country:'USA',taxpayerType:'individual',confirmed:true}),422);
 throws(()=>f.svc.taxAttestation(id,{country:'RU',taxpayerType:'broker',confirmed:true}),422);
 throws(()=>f.svc.taxAttestation(id,{country:'RU',taxpayerType:'individual',confirmed:false}),422);
 assert.equal(f.svc.taxAttestation(id,{country:'RU',taxpayerType:'individual',confirmed:true}).declared,true);
 assert.equal(f.svc.complianceStatus(id).taxCountry,'RU');
 }finally{f.close()}
});
test('R4 PAYOUT 02: vendor terms require explicit acceptance and version',()=>{
 const f=fixture();try{const id=f.recipient.user.id;throws(()=>f.svc.acceptPayoutTerms(id,{version:'WRONG',accepted:true}),422);
 throws(()=>f.svc.acceptPayoutTerms(id,{version:'DRAFT_R4',accepted:false}),422);
 assert.equal(f.svc.acceptPayoutTerms(id,{version:'DRAFT_R4',accepted:true}).draft,true);
 }finally{f.close()}
});
test('R4 PAYOUT 03: export requires the user to declare tax & accept draft vendor terms',()=>{
 const f=fixture();try{f.ready();throws(()=>f.svc.issuePayoutExport(f.c.user.id,f.payout.id),409);
 f.svc.taxAttestation(f.recipient.user.id,{country:'RU',taxpayerType:'individual',confirmed:true});
 throws(()=>f.svc.issuePayoutExport(f.c.user.id,f.payout.id),409);
 f.svc.acceptPayoutTerms(f.recipient.user.id,{version:'DRAFT_R4',accepted:true});
 const issued=f.svc.issuePayoutExport(f.c.user.id,f.payout.id);assert.ok(issued.readToken.length>30);assert.equal(issued.nonPayable,true);
 assert.notEqual(f.db.prepare('SELECT token_hash FROM payout_export_leases').get().token_hash,issued.readToken);
 }finally{f.close()}
});
test('R4 PAYOUT 04: author or reviewer cannot bypass independent third reviewer',()=>{
 const f=fixture();try{f.ready();f.svc.taxAttestation(f.recipient.user.id,{country:'RU',taxpayerType:'individual',confirmed:true});f.svc.acceptPayoutTerms(f.recipient.user.id,{version:'DRAFT_R4',accepted:true});
 for(const id of [f.recipient.user.id,f.a.user.id,f.b.user.id])throws(()=>f.svc.issuePayoutExport(id,f.payout.id),403);
 }finally{f.close()}
});
test('R4 PAYOUT 05: export token is single use, carries no bank data and never transfers funds',()=>{
 const f=fixture();try{f.ready();f.svc.taxAttestation(f.recipient.user.id,{country:'NL',taxpayerType:'business',confirmed:true});f.svc.acceptPayoutTerms(f.recipient.user.id,{version:'DRAFT_R4',accepted:true});
 const issued=f.svc.issuePayoutExport(f.c.user.id,f.payout.id),response=f.svc.readPayoutExport(f.c.user.id,f.payout.id,issued.readToken);
 assert.equal(response.realTransfer,false);assert.equal(response.bankDetailsIncluded,false);assert.equal(response.taxCountry,'NL');
 throws(()=>f.svc.readPayoutExport(f.c.user.id,f.payout.id,issued.readToken),403);
 throws(()=>f.svc.issuePayoutExport(f.c.user.id,f.payout.id),409);
 assert.equal(f.db.prepare('SELECT count(*) n FROM ledger_transactions').get().n,2);
 assert.equal(f.svc.verifyAudit().ok,true);
 }finally{f.close()}
});
test('R4 PAYOUT 06: revocation permanently invalidates lease and preparation',()=>{
 const f=fixture();try{f.ready();f.svc.taxAttestation(f.recipient.user.id,{country:'RU',taxpayerType:'individual',confirmed:true});f.svc.acceptPayoutTerms(f.recipient.user.id,{version:'DRAFT_R4',accepted:true});
 const issued=f.svc.issuePayoutExport(f.c.user.id,f.payout.id);assert.equal(f.svc.revokePayoutExport(f.a.user.id,f.payout.id).revoked,true);
 throws(()=>f.svc.readPayoutExport(f.c.user.id,f.payout.id,issued.readToken),403);
 throws(()=>f.svc.issuePayoutExport(f.c.user.id,f.payout.id),409);
 assert.equal(f.db.prepare('SELECT status FROM payout_preparations').get().status,'revoked');
 }finally{f.close()}
});
test('R4 PAYOUT 07: changing tax declaration revokes existing export and no reissue allowed',()=>{
 const f=fixture();try{f.ready();f.svc.taxAttestation(f.recipient.user.id,{country:'RU',taxpayerType:'individual',confirmed:true});f.svc.acceptPayoutTerms(f.recipient.user.id,{version:'DRAFT_R4',accepted:true});
 const issued=f.svc.issuePayoutExport(f.c.user.id,f.payout.id);
 f.svc.taxAttestation(f.recipient.user.id,{country:'NL',taxpayerType:'individual',confirmed:true});
 throws(()=>f.svc.readPayoutExport(f.c.user.id,f.payout.id,issued.readToken),403);
 throws(()=>f.svc.issuePayoutExport(f.c.user.id,f.payout.id),409);
 }finally{f.close()}
});
test('R4 PAYOUT 08: refund revokes prepared payout and outstanding export',()=>{
 const f=fixture();try{f.ready();f.svc.taxAttestation(f.recipient.user.id,{country:'RU',taxpayerType:'individual',confirmed:true});f.svc.acceptPayoutTerms(f.recipient.user.id,{version:'DRAFT_R4',accepted:true});
 const issued=f.svc.issuePayoutExport(f.c.user.id,f.payout.id);
 f.svc.processPaymentEvent({id:'r4_refund_evt_001',type:'payment.refunded',paymentExternalId:'r4_payout_payment_001',externalId:'r4_refund_001',amountCents:f.invoice.total_cents,provider:'TEST'});
 throws(()=>f.svc.readPayoutExport(f.c.user.id,f.payout.id,issued.readToken),403);
 assert.equal(f.db.prepare('SELECT revoked_at IS NOT NULL AS revoked FROM payout_export_leases').get().revoked,1);
 assert.equal(f.svc.verifyLedger().ok,true);
 }finally{f.close()}
});
test('R4 MAIL 09: signed outbound transport sends challenge only to approved HTTPS service',async()=>{
 let observed;const secret='long_r4_mail_transport_secret_1234567890';
 const result=await deliverVerificationEmail({url:'https://mail-proxy.example.test/send',secret,email:'user@example.test',token:'a'.repeat(43),fetchFn:async(u,opts)=>{observed={u,opts};return {status:202}}});
 assert.equal(result.delivered,true);const body=observed.opts.body;
 const expected=createHmac('sha256',secret).update(body).digest('hex');assert.equal(observed.opts.headers['x-proof-signature'],'sha256='+expected);
 await assert.rejects(()=>deliverVerificationEmail({url:'http://localhost:5000/send',secret,email:'user@example.test',token:'a'.repeat(43)}),e=>e.status===503);
});
test('R4 MAIL 10: HTTP email delivery hides challenge in response, token stays usable once',async()=>{
 const db=openDatabase(':memory:');let delivered;
 const app=createHttpServer({db,production:false,origin:'https://proof.test',mode:'disabled',emailDeliveryUrl:'https://mail-proxy.example.test/send',emailDeliverySecret:'m'.repeat(42),emailFetch:async(_,opts)=>{delivered=JSON.parse(opts.body);return {status:202}}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
 const send=async(path,{method='GET',body,sess}={})=>{const response=await fetch(base+path,{method,headers:{origin:'https://proof.test',...(body?{'content-type':'application/json'}:{}),...(sess?{cookie:sess.cookie,'x-csrf-token':sess.csrf}:{} )},body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]}};
 try{const reg=await send('/api/auth/register',{method:'POST',body:{name:'Test Email',email:'mail_r4@example.test',password:'not-a-weak-password-2026'}});const sess={cookie:reg.cookie,csrf:reg.data.csrf};
 const requested=await send('/api/compliance/email/request',{method:'POST',body:{},sess});assert.equal(requested.status,200);assert.equal(requested.data.delivered,true);assert.ok(delivered.token);
 assert.ok(!JSON.stringify(requested.data).includes(delivered.token));assert.equal(delivered.email,'mail_r4@example.test');
 assert.equal((await send('/api/compliance/email/confirm',{method:'POST',body:{token:delivered.token}})).status,200);
 assert.equal((await send('/api/compliance/email/confirm',{method:'POST',body:{token:delivered.token}})).status,403);
 }finally{await new Promise(r=>app.server.close(r));db.close()}
});
