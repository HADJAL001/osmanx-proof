import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db.mjs';
import { createHttpServer } from '../src/server.mjs';
import { signWebhook } from '../src/security.mjs';

async function serverFixture(mode='sandbox') {
 const db=openDatabase(':memory:');const secret='DEV_TEST_SECRET_FOR_INTEGRATION_SUITE_1234567';
 const app=createHttpServer({db,mode,origin:'http://local.test',webhookSecret:secret,ipSecret:'test_ip_salt_12345',production:false});
 await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${app.server.address().port}`;
 const json=async(path,{method='GET',body,cookie='',csrf='',origin='http://local.test',headers={}}={})=>{
  const r=await fetch(base+path,{method,headers:{...(body!==undefined?{'content-type':'application/json'}:{}),...(cookie?{cookie}:{}),...(csrf?{'x-csrf-token':csrf}:{}),...(origin?{origin}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]||''};
 };
 const register=async(name)=>{
  const x=await json('/api/auth/register',{method:'POST',body:{name,email:name.toLowerCase()+'@example.org',password:'SecurePassword123!'}});
  assert.equal(x.status,201);return {cookie:x.cookie,csrf:x.body.csrf,user:x.body.user,org:x.body.organizations[0].id};
 };
 return {...app,base,json,register,secret,close:async()=>{await new Promise(resolve=>app.server.close(resolve));db.close()}};
}
const quote={title:'Project X',items:[{description:'Audit',qty:2,unitPriceCents:30000,unitCostCents:12000}]};

test('HTTP 1: boots real SPA and stylesheet with defensive headers',async()=>{
 const f=await serverFixture();try{
  const x=await fetch(f.base+'/');assert.equal(x.status,200);assert.match(await x.text(),/OSMANX PROOF/);
  assert.match(x.headers.get('content-security-policy'),/script-src 'self'/);
  assert.equal((await fetch(f.base+'/app.js')).status,200);
  assert.equal((await fetch(f.base+'/print.css')).status,200);
 }finally{await f.close()}
});
test('HTTP 2: registration -> cookie -> GET me -> logout',async()=>{
 const f=await serverFixture();try{
  const u=await f.register('Alice');const me=await f.json('/api/me',{cookie:u.cookie});assert.equal(me.body.authenticated,true);
  assert.equal(me.body.organizations[0].id,u.org);
  const out=await f.json('/api/auth/logout',{method:'POST',body:{},cookie:u.cookie,csrf:u.csrf});assert.equal(out.status,200);
  assert.equal((await f.json('/api/me',{cookie:u.cookie})).body.authenticated,false);
 }finally{await f.close()}
});
test('HTTP 3: CSRF and origin checks block cross-site quote creation',async()=>{
 const f=await serverFixture();try{
  const u=await f.register('Alice');
  const noCsrf=await f.json('/api/quotes',{method:'POST',body:{...quote,orgId:u.org},cookie:u.cookie});assert.equal(noCsrf.status,403);
  const badOrigin=await f.json('/api/quotes',{method:'POST',body:{...quote,orgId:u.org},cookie:u.cookie,csrf:u.csrf,origin:'https://evil.example'});assert.equal(badOrigin.status,403);
  const yes=await f.json('/api/quotes',{method:'POST',body:{...quote,orgId:u.org},cookie:u.cookie,csrf:u.csrf});assert.equal(yes.status,201);
 }finally{await f.close()}
});
test('HTTP 4: proposal creation, editing, print, share and tenant isolation',async()=>{
 const f=await serverFixture();try{
  const a=await f.register('Alice'),b=await f.register('Bob');
  const made=await f.json('/api/quotes',{method:'POST',body:{...quote,orgId:a.org},cookie:a.cookie,csrf:a.csrf});
  const id=made.body.quote.id;
  assert.equal(made.body.quote.math.totalCents,60000);
  const update=await f.json('/api/quotes/'+id,{method:'PATCH',body:{...quote,title:'Updated'},cookie:a.cookie,csrf:a.csrf});assert.equal(update.body.quote.title,'Updated');
  const denied=await f.json('/api/quotes/'+id,{cookie:b.cookie});assert.equal(denied.status,403);
  const printed=await fetch(f.base+'/api/quotes/'+id+'/print',{headers:{cookie:a.cookie}});assert.equal(printed.status,200);assert.match(await printed.text(),/Updated/);
  const share=await f.json('/api/quotes/'+id+'/share',{method:'POST',body:{},cookie:a.cookie,csrf:a.csrf});const publicDoc=await fetch(share.body.url.replace('http://local.test',f.base));assert.equal(publicDoc.status,200);
  assert.match(await publicDoc.text(),/Updated/);
 }finally{await f.close()}
});
test('HTTP 5: signed event endpoint rejects wrong signature and processes valid payment once',async()=>{
 const f=await serverFixture('bridge');try{
  const a=await f.register('Alice');const x=await f.json('/api/invoices',{method:'POST',body:{orgId:a.org},cookie:a.cookie,csrf:a.csrf});const i=x.body.invoice;
  const event={id:'event_integration_12345',type:'payment.succeeded',provider:'BRIDGE_TEST',invoiceId:i.id,externalId:'ext-integration-12345',amountCents:i.total_cents,currency:'RUB'};
  const raw=JSON.stringify(event),timestamp=String(Math.floor(Date.now()/1000));
  const bad=await fetch(f.base+'/api/webhooks/payments',{method:'POST',headers:{'x-osx-timestamp':timestamp,'x-osx-signature':'0'.repeat(64)},body:raw});assert.equal(bad.status,401);
  const h={'x-osx-timestamp':timestamp,'x-osx-signature':signWebhook(raw,timestamp,f.secret)};
  const good=await fetch(f.base+'/api/webhooks/payments',{method:'POST',headers:h,body:raw});assert.equal(good.status,200);assert.equal((await good.json()).duplicate,false);
  const repeat=await fetch(f.base+'/api/webhooks/payments',{method:'POST',headers:h,body:raw});assert.equal((await repeat.json()).duplicate,true);
  const me=await f.json('/api/me',{cookie:a.cookie});assert.equal(me.body.organizations[0].plan,'pro');
 }finally{await f.close()}
});
test('HTTP 6: sandbox payment is clearly simulated and restricted to invoice buyer',async()=>{
 const f=await serverFixture();try{
  const a=await f.register('Alice'),b=await f.register('Bob');const inv=await f.json('/api/invoices',{method:'POST',body:{orgId:a.org},cookie:a.cookie,csrf:a.csrf});const i=inv.body.invoice;
  const denied=await f.json('/api/sandbox/pay',{method:'POST',body:{orgId:a.org,invoiceId:i.id},cookie:b.cookie,csrf:b.csrf});assert.equal(denied.status,403);
  const paid=await f.json('/api/sandbox/pay',{method:'POST',body:{orgId:a.org,invoiceId:i.id},cookie:a.cookie,csrf:a.csrf});assert.equal(paid.status,200);assert.equal(paid.body.demo,true);
  assert.equal((await f.json('/api/invoices?orgId='+a.org,{cookie:a.cookie})).body.invoices[0].status,'paid');
 }finally{await f.close()}
});
test('HTTP 7: unprivileged accounts cannot access audit or payment refunds',async()=>{
 const f=await serverFixture();try{
  const a=await f.register('Alice');assert.equal((await f.json('/api/admin',{cookie:a.cookie})).status,403);
  const refund=await f.json('/api/sandbox/refund',{method:'POST',body:{paymentExternalId:'foo',amountCents:1},cookie:a.cookie,csrf:a.csrf});assert.equal(refund.status,403);
  assert.equal((await f.json('/api/referrals/me',{cookie:a.cookie})).status,200);
 }finally{await f.close()}
});
test('HTTP 8: malicious proposal title is escaped in printable HTML',async()=>{
 const f=await serverFixture();try{
  const a=await f.register('Alice');const raw='<img src=x onerror=alert(1)>';
  const x=await f.json('/api/quotes',{method:'POST',body:{...quote,title:raw,orgId:a.org},cookie:a.cookie,csrf:a.csrf});
  const r=await fetch(f.base+'/api/quotes/'+x.body.quote.id+'/print',{headers:{cookie:a.cookie}});const html=await r.text();
  assert.ok(html.includes('&lt;img'));assert.equal(html.includes('<img src=x onerror='),false);
 }finally{await f.close()}
});
test('HTTP 9: changing locale persists on user profile',async()=>{
 const f=await serverFixture();try{
  const a=await f.register('Alice');const x=await f.json('/api/me/locale',{method:'PATCH',body:{locale:'en'},cookie:a.cookie,csrf:a.csrf});assert.equal(x.status,200);
  const me=await f.json('/api/me',{cookie:a.cookie});assert.equal(me.body.user.locale,'en');
 }finally{await f.close()}
});
test('HTTP 10: production cannot start with simulated payments',()=>{
 const db=openDatabase(':memory:');try{assert.throws(()=>createHttpServer({db,mode:'sandbox',production:true}),/forbidden in production/)}finally{db.close()}
});
