import http from 'node:http';
import { isIP } from 'node:net';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHmac, randomBytes } from 'node:crypto';
import { openDatabase } from './db.mjs';
import { createServices } from './services.mjs';
import { HttpError, assert, sha, verifyWebhook, signWebhook, cleanText } from './security.mjs';
import { PRO_PRICE_CENTS } from './finance.mjs';
import { verifyStripeSignature, mapStripeTestEvent, createStripeTestIntent, createStripeTestCheckout, verifyStripeTestSettlement } from './stripe-test.mjs';
import { createMetrics, secureMetricsToken } from './metrics.mjs';
import {deliverVerificationEmail} from './email-delivery.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const readPublic=name=>readFileSync(resolve(root,'public',name));
const css=readPublic('styles.css'),js=readPublic('app.js'),index=readPublic('index.html'),printCss=readPublic('print.css'),printJs=readPublic('print.js'),reviewJs=readPublic('review.js'),clientCss=readPublic('client.css'),clientJs=readPublic('client.js');
const escapeHTML=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=c=>(c/100).toLocaleString('ru-RU',{style:'currency',currency:'RUB'});
const formatClient=(p)=>`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta name="robots" content="noindex,nofollow"><title>${escapeHTML(p.title)} — OSMANX PROOF</title><link rel="stylesheet" href="/client.css"><script defer src="/client.js"></script></head><body><div class="page"><header><strong>OSMANX <span>PROOF</span></strong><small>CLIENT WORK PORTAL · R5</small></header><section class="hero"><div class="eyebrow">ПРОГРЕСС ВЫПОЛНЕНИЯ / WORK PROGRESS</div><h1>${escapeHTML(p.title)}</h1><p>Заказчик / Client: ${escapeHTML(p.clientName)}</p><div class="chip">${escapeHTML(p.status)}</div></section><main>${p.milestones.map(m=>`<article class="milestone"><div class="line"><h2>${escapeHTML(m.title)}</h2><span class="chip">${escapeHTML(m.status)}</span></div><p>${escapeHTML(m.description)}</p>${m.submittedSummary?`<div class="submission"><strong>Представленный результат / Submitted work</strong><p>${escapeHTML(m.submittedSummary)}</p></div>`:''}${m.status==='submitted'?`<form data-milestone="${m.id}"><input type="hidden" name="submissionRevision" value="${m.submittedRevision}"><label>Ваше имя / Your name<input name="name" maxlength="120" required></label><label>Комментарий / Message<textarea name="message" maxlength="1600"></textarea></label><label class="checkbox"><input type="checkbox" name="consent" required> Подтверждаю запись ответа / I agree to record my response</label><div class="actions"><button data-decision="accepted" type="submit">Принять этап / Accept</button><button data-decision="changes_requested" type="submit" class="alt">Запросить правки / Changes</button></div><p role="status" class="result"></p></form>`:''}</article>`).join('')||'<p>Этапов пока нет / No milestones yet</p>'}</main><footer>Ответ подтверждается по временной ссылке и не является квалифицированной электронной подписью. <span>/ This is not a verified legal signature.</span></footer></div></body></html>`;
const formatHtml=(q,{clientReview=false}={})=>{
 const lines=q.items.map(i=>`<tr><td>${escapeHTML(i.description)}</td><td>${i.qty}</td><td>${money(i.unitPriceCents)}</td><td>${money(i.qty*i.unitPriceCents)}</td></tr>`).join('');
 return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><title>${escapeHTML(q.title)} — OSMANX PROOF</title><link rel="stylesheet" href="/print.css"><script defer src="/print.js"></script></head><body><p class="muted">OSMANX PROOF · COMMERCIAL OFFER</p><h1>${escapeHTML(q.title)}</h1><p>Клиент: ${escapeHTML(q.clientName||'—')}</p><p class="muted">Предложение № ${escapeHTML(q.id.slice(0,8).toUpperCase())} · ${escapeHTML(q.createdAt.slice(0,10))}</p><table><thead><tr><th>Услуга</th><th>Кол-во</th><th>Цена</th><th>Сумма</th></tr></thead><tbody>${lines}</tbody></table><div class="summary"><p>Подытог: ${money(q.math.subtotalCents)}</p><p>Скидка: ${money(q.math.discountCents)}</p><p>Налог: ${money(q.math.taxCents)}</p><h2>Итого: ${money(q.math.totalCents)}</h2></div><p class="muted">Предложение подготовлено с помощью OSMANX PROOF. Подтверждение условий производится непосредственно сторонами.</p><button class="print" id="print-button">Печать / Сохранить PDF</button>${clientReview?`<section class="review" id="review"><h2>Ответ на предложение / Proposal response</h2><p class="muted">Нажатие фиксирует ответ на версию предложения № ${q.revision}. Это подтверждение по ссылке, а не проверенная электронная подпись.</p><label>Имя / Name<input id="respond-name" maxlength="120" required placeholder="Ваше имя"></label><label>Комментарий / Message<textarea id="respond-message" maxlength="1600" placeholder="Что нужно изменить?"></textarea></label><label class="consent"><input type="checkbox" id="respond-consent"> Я подтверждаю свой ответ и понимаю, что он будет сохранён / I consent to record this response</label><div class="review-actions"><button type="button" id="respond-accept">Принять / Accept</button><button type="button" id="respond-changes">Запросить изменения / Request changes</button></div><p id="respond-feedback" role="status"></p></section><script defer src="/review.js"></script>`:''}</body></html>`;
};
export function createHttpServer(options={}){
 const db=options.db||openDatabase(options.dbPath);
 const svc=options.svc||createServices(db,options);
 const mode=options.mode||process.env.PAYMENT_MODE||(process.env.NODE_ENV==='production'?'disabled':'sandbox');
 const origin=options.origin||process.env.APP_ORIGIN||'http://127.0.0.1:3100';
 const prod=(options.production??(process.env.NODE_ENV==='production'));
 const secret=options.webhookSecret||process.env.WEBHOOK_SECRET||'';
 const ipSecret=options.ipSecret||process.env.IP_HASH_SECRET||'development-not-secret';
 const stripeWebhookSecret=options.stripeWebhookSecret||process.env.STRIPE_TEST_WEBHOOK_SECRET||'';
 const stripeSecretKey=options.stripeSecretKey||process.env.STRIPE_TEST_SECRET_KEY||'';
 const stripeFetch=options.stripeFetch||fetch;
 const metricsSecret=options.metricsSecret||process.env.METRICS_SECRET||'';
 const metrics=createMetrics();
 const emailTestMode=options.emailTestMode??(process.env.EMAIL_TEST_MODE==='1');
 const mailUrl=options.emailDeliveryUrl||process.env.MAIL_DELIVERY_URL||'';
 const mailSecret=options.emailDeliverySecret||process.env.MAIL_DELIVERY_SECRET||'';
 const mailFetch=options.emailFetch||fetch;
 const trustedProxies=new Set(String(options.trustedProxyIps??process.env.TRUSTED_PROXY_IPS??'').split(',').map(s=>s.trim()).filter(s=>isIP(s)));
 const localRate=new Map();
 const maxLimit=80;
 if(prod&&['sandbox','stripe_test'].includes(mode))throw Error('Sandbox and Stripe TEST payments are forbidden in production');
 if(prod&&!origin.startsWith('https://'))throw Error('Production APP_ORIGIN must use HTTPS');
 if(prod&&ipSecret.length<32)throw Error('IP_HASH_SECRET must contain at least 32 characters in production');
 if(prod&&mode==='bridge'&&secret.length<32)throw Error('WEBHOOK_SECRET must contain at least 32 characters');
 function rateLimit(ip,key,limit=15){
  const k=`${key}:${ip}`,t=Date.now(),r=localRate.get(k)||{count:0,until:t+60000};if(t>r.until){r.count=0;r.until=t+60000}r.count++;localRate.set(k,r);
  assert(r.count<=limit,429,'Too many requests. Try again shortly','RATE_LIMIT');
  if(localRate.size>10000){for(const [x,v] of localRate)if(v.until<t)localRate.delete(x);}
 }
 const send=(res,status,data,headers={})=>{
  const body=JSON.stringify(data);res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store',...headers});res.end(body);
 };
 const file=(res,body,type)=>{res.writeHead(200,{'content-type':type,'cache-control':'public,max-age=300'});res.end(body)};
 const getCookies=req=>Object.fromEntries((req.headers.cookie||'').split(';').filter(Boolean).map(s=>{let at=s.indexOf('=');return [s.slice(0,at).trim(),s.slice(at+1).trim()]}));
 const rawBody=async(req,max=65536)=>{let chunks=[],size=0;for await(const chunk of req){size+=chunk.length;if(size>max)throw new HttpError(413,'Request too large');chunks.push(chunk)}return Buffer.concat(chunks).toString('utf8');};
 const jsonBody=async(req,max=65536)=>{
  assert((req.headers['content-type']||'').startsWith('application/json'),415,'Content-Type must be application/json');
  const raw=await rawBody(req,max);let data;try{data=JSON.parse(raw)}catch{throw new HttpError(400,'Malformed JSON')};
  assert(data&&typeof data==='object'&&!Array.isArray(data),422,'JSON object required');return data;
 };
 function cookieVal(value,remove=false){
  const parts=[`osx_session=${remove?'':value}`,'Path=/','HttpOnly','SameSite=Lax',remove?'Max-Age=0':`Max-Age=${7*24*3600}`];
  if(prod)parts.push('Secure');return parts.join('; ');
 }
 function ipOf(req){
  const peer=req.socket.remoteAddress||'unknown';
  if(!trustedProxies.has(peer))return peer; // Never trust client-supplied X-Forwarded-For directly.
  const forwarded=String(req.headers['x-forwarded-for']||'').split(',').map(s=>s.trim());
  for(let i=forwarded.length-1;i>=0;i--){const ip=forwarded[i];if(isIP(ip)&&!trustedProxies.has(ip))return ip;}
  return peer;
 }
 function sessionOf(req){return svc.getSession(getCookies(req).osx_session||'');}
 function requireAuth(session){assert(session?.user,401,'Please sign in','UNAUTHORIZED');return session.user.id}
 function protect(req,session){
  const src=req.headers.origin;
  if(src&&src!==origin)throw new HttpError(403,'Cross-origin request blocked','ORIGIN');
  if(session){assert(req.headers['x-csrf-token']===session.csrf,403,'CSRF token mismatch','CSRF');}
 }
 const adminRoute=(id)=>svc.admin(id);
 const server=http.createServer(async(req,res)=>{
  const startPath=(req.url||'/').split('?')[0];
  const started=process.hrtime.bigint();
  res.once('finish',()=>metrics.observe(req.method||'OTHER',startPath,res.statusCode,Number(process.hrtime.bigint()-started)/1e6));
  res.setHeader('x-content-type-options','nosniff');res.setHeader('referrer-policy','strict-origin-when-cross-origin');
  res.setHeader('x-frame-options','DENY');res.setHeader('permissions-policy','camera=(),microphone=(),geolocation=()');
  res.setHeader('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try{
   if(req.method==='GET'&&startPath==='/ops/metrics'){
    assert(secureMetricsToken(req.headers.authorization,metricsSecret),401,'Metrics token required','UNAUTHORIZED');
    res.writeHead(200,{'content-type':'text/plain; version=0.0.4; charset=utf-8','cache-control':'no-store'});
    return res.end(metrics.prometheus());
   }
   if(req.method==='GET'&&startPath==='/health')return send(res,200,{ok:true,service:'OSMANX PROOF R5',status:'up'});
   if(req.method==='GET'&&startPath==='/ready'){
    const dbOk=db.prepare('PRAGMA quick_check').get().quick_check==='ok';
    const ledger=svc.verifyLedger(),audit=svc.verifyAudit();
    return send(res,dbOk&&ledger.ok&&audit.ok?200:503,{ready:dbOk&&ledger.ok&&audit.ok,dbOk,ledgerOk:ledger.ok,auditOk:audit.ok});
   }
   if(req.method==='GET'&&startPath==='/styles.css')return file(res,css,'text/css; charset=utf-8');
   if(req.method==='GET'&&startPath==='/app.js')return file(res,js,'text/javascript; charset=utf-8');
   if(req.method==='GET'&&startPath==='/print.css')return file(res,printCss,'text/css; charset=utf-8');
   if(req.method==='GET'&&startPath==='/print.js')return file(res,printJs,'text/javascript; charset=utf-8');
   if(req.method==='GET'&&startPath==='/review.js')return file(res,reviewJs,'text/javascript; charset=utf-8');
   if(req.method==='GET'&&startPath==='/client.css')return file(res,clientCss,'text/css; charset=utf-8');
   if(req.method==='GET'&&startPath==='/client.js')return file(res,clientJs,'text/javascript; charset=utf-8');
   if(req.method==='GET'&&/^\/c\/[A-Za-z0-9_-]+$/.test(startPath)){
    const p=svc.workflow.publicDetails(startPath.slice(3));res.setHeader('referrer-policy','no-referrer');
    res.setHeader('x-robots-tag','noindex,nofollow');res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});return res.end(formatClient(p));
   }
   if(req.method==='GET'&&(startPath==='/'||startPath==='/app'))return file(res,index,'text/html; charset=utf-8');
   if(req.method==='GET'&&startPath.startsWith('/s/')){
    const q=svc.quoteByShare(startPath.slice(3));res.setHeader('referrer-policy','no-referrer');
    // Public proposal documents are intentionally non-indexed and time-limited.
    res.setHeader('x-robots-tag','noindex,nofollow');res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});return res.end(formatHtml(q,{clientReview:true}));
   }
   if(!startPath.startsWith('/api/'))throw new HttpError(404,'Not found');
   const path=startPath.slice(4),url=new URL(req.url,origin),session=sessionOf(req),id=session?.user?.id;
   const publicMilestone=path.match(/^\/public\/projects\/([A-Za-z0-9_-]+)\/milestones\/([A-Za-z0-9_-]+)\/respond$/);
   if(req.method==='POST'&&publicMilestone){
    const suppliedOrigin=req.headers.origin;
    assert(!suppliedOrigin||suppliedOrigin===origin,403,'Cross-origin client response blocked','ORIGIN');
    rateLimit(ipOf(req),'client-milestone-response',20);
    const body=await jsonBody(req),fingerprint=createHmac('sha256',ipSecret).update(ipOf(req)).digest('hex');
    return send(res,201,{ok:true,...svc.workflow.respond(publicMilestone[1],publicMilestone[2],body,fingerprint)});
   }
   const publicProject=path.match(/^\/public\/projects\/([A-Za-z0-9_-]+)$/);
   if(req.method==='GET'&&publicProject)return send(res,200,{ok:true,project:svc.workflow.publicDetails(publicProject[1])});
   const publicResponse=path.match(/^\/public\/quotes\/([A-Za-z0-9_-]+)\/respond$/);
   if(req.method==='POST'&&publicResponse){
    const suppliedOrigin=req.headers.origin;
    assert(!suppliedOrigin||suppliedOrigin===origin,403,'Cross-origin public response blocked','ORIGIN');
    rateLimit(ipOf(req),'quote-response',20);
    const b=await jsonBody(req),fingerprint=createHmac('sha256',ipSecret).update(ipOf(req)).digest('hex');
    return send(res,201,{ok:true,...svc.respondToQuote(publicResponse[1],b,fingerprint)});
   }
   if(req.method==='POST'&&path==='/webhooks/payments'){
    assert(mode==='bridge'||mode==='sandbox',503,'Payment bridge disabled');
    const raw=await rawBody(req),t=req.headers['x-osx-timestamp'],sig=req.headers['x-osx-signature'];
    assert(verifyWebhook(raw,t,sig,secret),401,'Invalid signed webhook','INVALID_SIGNATURE');
    let event;try{event=JSON.parse(raw)}catch{throw new HttpError(400,'Invalid webhook JSON')}
    return send(res,200,{ok:true,...svc.processPaymentEvent(event)});
   }
   if(req.method==='POST'&&path==='/webhooks/stripe-test'){
    assert(mode==='stripe_test'&&!prod,503,'Stripe test webhook disabled');
    const raw=await rawBody(req,256*1024);
    verifyStripeSignature(raw,req.headers['stripe-signature'],stripeWebhookSecret);
    let event;try{event=JSON.parse(raw)}catch{throw new HttpError(400,'Invalid Stripe JSON')}
    const mapped=mapStripeTestEvent(event);
    if(!mapped)return send(res,200,{ok:true,ignored:true});
    if(mapped.type==='payment.succeeded'&&svc.partner450.isOrder(mapped.invoiceId))
     return send(res,200,{ok:true,...svc.partner450.processEvent(mapped)});
    if(mapped.type==='payment.refunded'&&svc.partner450.isPayment(mapped.paymentExternalId))
     return send(res,200,{ok:true,...svc.partner450.processEvent(mapped)});
    return send(res,200,{ok:true,...svc.processPaymentEvent(mapped)});
   }
   if(req.method==='POST'&&path==='/compliance/email/confirm'){
    const b=await jsonBody(req);rateLimit(ipOf(req),'email-confirm',15);
    return send(res,200,{ok:true,...svc.confirmEmailChallenge(b.token)});
   }
   // Public read-only B2B catalogue; free affiliate registration uses /auth/register.
   if(req.method==='GET'&&path==='/partner450/catalog')
    return send(res,200,{ok:true,...svc.partner450.catalog()});
   if(req.method==='POST'&&path==='/auth/register'){
    protect(req,null);rateLimit(ipOf(req),'register',5);
    const body=await jsonBody(req);
    const ipHash=createHmac('sha256',ipSecret).update(ipOf(req)).digest('hex');
    const reg=svc.createUser({...body,ipHash,referralCode:body.referralCode||''});const created=svc.createSession(reg.user.id);
    return send(res,201,{ok:true,user:reg.user,csrf:created.csrf,organizations:svc.orgs(reg.user.id)}, {'set-cookie':cookieVal(created.secret)});
   }
   if(req.method==='POST'&&path==='/auth/login'){
    protect(req,null);rateLimit(ipOf(req),'login',10);const body=await jsonBody(req);
    const user=svc.authenticate(body.email,body.password),created=svc.createSession(user.id);
    return send(res,200,{ok:true,user,csrf:created.csrf,organizations:svc.orgs(user.id)},{'set-cookie':cookieVal(created.secret)});
   }
   if(req.method==='GET'&&path==='/me'){
    return send(res,200,{ok:true,authenticated:!!session,user:session?.user||null,csrf:session?.csrf||null,organizations:session?svc.orgs(id):[],paymentMode:mode,proPriceCents:PRO_PRICE_CENTS,isDemo:mode==='sandbox'});
   }
   requireAuth(session);
   if(!['GET','HEAD'].includes(req.method))protect(req,session);
   if(req.method==='POST'&&path==='/auth/logout'){
    svc.revokeSession(getCookies(req).osx_session,id);return send(res,200,{ok:true},{'set-cookie':cookieVal('',true)});
   }
   if(req.method==='GET'&&path==='/compliance/status')return send(res,200,{ok:true,...svc.complianceStatus(id)});
   if(req.method==='POST'&&path==='/compliance/email/request'){
    rateLimit(ipOf(req),'email-request:'+id,5);
    const testMode=!prod&&emailTestMode===true;
    const result=svc.verificationChallenge(id,{testMode,deliveryMode:!!mailUrl&&!!mailSecret});
    if(testMode||result.alreadyVerified)return send(res,200,{ok:true,...result});
    const email=session.user.email;
    await deliverVerificationEmail({url:mailUrl,secret:mailSecret,email,token:result.transportToken,fetchFn:mailFetch});
    return send(res,200,{ok:true,delivered:true,expiresAt:result.expiresAt,delivery:'OUTBOUND_SIGNED'});
   }
   if(req.method==='POST'&&path==='/compliance/payout/tax')return send(res,200,{ok:true,...svc.taxAttestation(id,await jsonBody(req))});
   if(req.method==='POST'&&path==='/compliance/payout/terms')return send(res,200,{ok:true,...svc.acceptPayoutTerms(id,await jsonBody(req))});
   let exportRoute=path.match(/^\/admin\/payouts\/([\w-]+)\/export\/(issue|read|revoke)$/);
   if(req.method==='POST'&&exportRoute){const b=await jsonBody(req);
    const requestId=exportRoute[1];const op=exportRoute[2];
    const response=op==='issue'?svc.issuePayoutExport(id,requestId):op==='read'?svc.readPayoutExport(id,requestId,b.readToken):svc.revokePayoutExport(id,requestId);
    return send(res,200,{ok:true,...response});
   }
   if(req.method==='POST'&&path==='/compliance/consents')return send(res,200,{ok:true,...svc.acceptLegalTerms(id,await jsonBody(req))});
   if(req.method==='POST'&&path==='/compliance/identity/request')return send(res,200,{ok:true,...svc.requestIdentityReview(id)});
   if(req.method==='GET'&&path==='/compliance/data-export')return send(res,200,{ok:true,data:svc.selfDataExport(id)});
   if(req.method==='POST'&&path==='/compliance/privacy/request'){const b=await jsonBody(req);return send(res,201,{ok:true,...svc.privacyRequest(id,b.kind)})}
   let cm=path.match(/^\/admin\/compliance\/identity\/([\w-]+)\/review$/);
   if(req.method==='POST'&&cm){const b=await jsonBody(req);return send(res,200,{ok:true,...svc.reviewIdentity(id,cm[1],b.status)})}
   cm=path.match(/^\/admin\/payouts\/([\w-]+)\/prepare$/);
   if(req.method==='POST'&&cm)return send(res,200,{ok:true,...svc.preparePayout(id,cm[1])});
   if(req.method==='PATCH'&&path==='/me/locale'){const b=await jsonBody(req);return send(res,200,{ok:true,user:svc.setLocale(id,b.locale)})}
   if(req.method==='POST'&&path==='/orgs'){
    const b=await jsonBody(req),orgId=svc.createOrganization(id,b.name);return send(res,201,{ok:true,orgId});
   }
   let m=path.match(/^\/orgs\/([\w-]+)\/invite$/);
   if(req.method==='POST'&&m){const b=await jsonBody(req);return send(res,201,{ok:true,...svc.invite(id,m[1],b.email,b.role)})}
   if(req.method==='POST'&&path==='/invitations/accept'){const b=await jsonBody(req);return send(res,200,{ok:true,...svc.acceptInvite(id,b.token)})}
   if(req.method==='GET'&&path==='/projects')return send(res,200,{ok:true,projects:svc.workflow.list(id,url.searchParams.get('orgId'))});
   if(req.method==='POST'&&path==='/projects'){
    const b=await jsonBody(req);return send(res,201,{ok:true,project:svc.workflow.launch(id,b.quoteId)});
   }
   if(req.method==='GET'&&path==='/projects/metrics')return send(res,200,{ok:true,metrics:svc.workflow.metrics(id,url.searchParams.get('orgId'))});
   if(req.method==='GET'&&path==='/projects/export.csv'){
    const rows=svc.workflow.exportRows(id,url.searchParams.get('orgId'));
    const cell=v=>{let s=String(v??'');if(/^[\s\uFEFF]*[=+@-]|^[\t\r\n]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"'};
    const cols=['id','title','client_name','status','total_cents','milestones','accepted','updated_at'];
    const csv=[cols.join(','),...rows.map(x=>cols.map(k=>cell(x[k])).join(','))].join('\r\n')+'\r\n';
    res.writeHead(200,{'content-type':'text/csv; charset=utf-8','content-disposition':'attachment; filename="osmanx-projects.csv"','cache-control':'no-store'});
    return res.end('\ufeff'+csv);
   }
   let wm=path.match(/^\/projects\/([\w-]+)\/milestones\/([\w-]+)\/(submit)$/);
   if(req.method==='POST'&&wm){const b=await jsonBody(req);return send(res,200,{ok:true,project:svc.workflow.submitMilestone(id,wm[1],wm[2],b)});}
   wm=path.match(/^\/projects\/([\w-]+)\/milestones\/([\w-]+)$/);
   if(req.method==='PATCH'&&wm){const b=await jsonBody(req);return send(res,200,{ok:true,project:svc.workflow.updateMilestone(id,wm[1],wm[2],b)});}
   wm=path.match(/^\/projects\/([\w-]+)\/milestones$/);
   if(req.method==='POST'&&wm){const b=await jsonBody(req);return send(res,201,{ok:true,project:svc.workflow.createMilestone(id,wm[1],b)});}
   wm=path.match(/^\/projects\/([\w-]+)\/shares\/([\w-]+)\/revoke$/);
   if(req.method==='POST'&&wm)return send(res,200,{ok:true,...svc.workflow.revoke(id,wm[1],wm[2])});
   wm=path.match(/^\/projects\/([\w-]+)\/share$/);
   if(req.method==='POST'&&wm){const r=svc.workflow.share(id,wm[1]);return send(res,201,{ok:true,url:`${origin}/c/${r.token}`,shareId:r.shareId,expiresAt:r.expiresAt});}
   wm=path.match(/^\/projects\/([\w-]+)$/);
   if(req.method==='GET'&&wm)return send(res,200,{ok:true,project:svc.workflow.details(id,wm[1])});
   if(req.method==='GET'&&path==='/quotes')return send(res,200,{ok:true,quotes:svc.listQuotes(id,url.searchParams.get('orgId'))});
   if(req.method==='POST'&&path==='/quotes'){
    const b=await jsonBody(req);return send(res,201,{ok:true,quote:svc.createQuote(id,b.orgId,b)});
   }
   m=path.match(/^\/quotes\/([\w-]+)(?:\/(share|status|print))?$/);
   if(m){
    const qid=m[1],op=m[2];
    if(req.method==='GET'&&!op)return send(res,200,{ok:true,quote:svc.getQuote(id,qid)});
    if(req.method==='PATCH'&&!op){const b=await jsonBody(req);return send(res,200,{ok:true,quote:svc.updateQuote(id,qid,b)})}
    if(req.method==='POST'&&op==='status'){const b=await jsonBody(req);return send(res,200,{ok:true,quote:svc.quoteStatus(id,qid,b.status)})}
    if(req.method==='POST'&&op==='share'){const result=svc.shareQuote(id,qid);return send(res,201,{ok:true,url:`${origin}/s/${result.token}`,expiresAt:result.expiresAt})}
    if(req.method==='GET'&&op==='print'){
     const q=svc.getQuote(id,qid);res.setHeader('referrer-policy','no-referrer');res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});return res.end(formatHtml(q));
    }
   }
   if(req.method==='GET'&&path==='/subscriptions')return send(res,200,{ok:true,subscription:svc.subscriptionDetails(id,url.searchParams.get('orgId'))});
   m=path.match(/^\/subscriptions\/([\w-]+)\/(cancel|resume)$/);
   if(req.method==='POST'&&m)return send(res,200,{ok:true,subscription:svc.changeSubscription(id,m[1],m[2])});
   // PARTNER 450: every purchase is a stand-alone, specified service order.
   if(req.method==='GET'&&path==='/partner450/me'){
    const data=svc.partner450.wallet(id);return send(res,200,{ok:true,...data,referralUrl:`${origin}/?ref=${encodeURIComponent(data.code)}`});
   }
   if(req.method==='GET'&&path==='/partner450/orders')return send(res,200,{ok:true,orders:svc.partner450.orders(id,url.searchParams.get('orgId'))});
   if(req.method==='POST'&&path==='/partner450/orders'){
    rateLimit(ipOf(req),'partner450-order:'+id,12);
    const b=await jsonBody(req);return send(res,201,{ok:true,order:svc.partner450.createOrder(id,b)});
   }
   let partnerRoute=path.match(/^\/partner450\/orders\/([\w-]+)\/(intent|sandbox-pay|accept)$/);
   if(req.method==='POST'&&partnerRoute){
    const [_,orderId,action]=partnerRoute;
    if(action==='accept')return send(res,200,{ok:true,...svc.partner450.accept(id,orderId,await jsonBody(req))});
    const order=svc.partner450.orderForBuyer(id,orderId);
    if(action==='sandbox-pay'){
     assert(mode==='sandbox'&&!prod,403,'Sandbox simulation disabled');rateLimit(ipOf(req),'partner450-sim:'+id,5);
     return send(res,200,{ok:true,...svc.partner450.processEvent({id:'evt_partner_sandbox_'+crypto.randomUUID(),
      type:'payment.succeeded',provider:'SANDBOX_NO_REAL_MONEY',invoiceId:order.id,
      externalId:'sandbox_p450_'+crypto.randomUUID(),amountCents:order.amount_cents,currency:'RUB'},{sandbox:true})});
    }
    assert(mode==='stripe_test'&&!prod,403,'Stripe TEST disabled');rateLimit(ipOf(req),'partner450-test-intent:'+id,5);
    const invoice={...order,id:order.id,total_cents:order.amount_cents,status:order.status,currency:'RUB'};
    const result=await createStripeTestIntent(invoice,{secretKey:stripeSecretKey,fetchFn:stripeFetch});
    svc.partner450.bindTestIntent(id,order.id,result.intentId);
    return send(res,200,{ok:true,intent:result});
   }
   if(req.method==='GET'&&path==='/admin/partner450/orders')return send(res,200,{ok:true,orders:svc.partner450.adminOrders(id)});
   if(req.method==='POST'&&path==='/admin/partner450/review')return send(res,200,{ok:true,...svc.partner450.settle(id)});
   let partnerAdmin=path.match(/^\/admin\/partner450\/orders\/([\w-]+)\/(deliver|sandbox-refund)$/);
   if(req.method==='POST'&&partnerAdmin){
    if(partnerAdmin[2]==='deliver')return send(res,200,{ok:true,order:svc.partner450.deliver(id,partnerAdmin[1],await jsonBody(req))});
    svc.admin(id);assert(mode==='sandbox'&&!prod,403,'Sandbox refund unavailable');
    const b=await jsonBody(req);
    const payment=db.prepare('SELECT * FROM partner450_payments WHERE order_id=?').get(partnerAdmin[1]);
    assert(payment?.provider==='SANDBOX_NO_REAL_MONEY',404,'Simulated payment not found');
    return send(res,200,{ok:true,...svc.partner450.processEvent({id:'evt_partner_refund_'+crypto.randomUUID(),
     type:'payment.refunded',provider:'SANDBOX_NO_REAL_MONEY',paymentExternalId:payment.external_id,
     externalId:'sandbox_ref_'+crypto.randomUUID(),amountCents:b.amountCents},{sandbox:true})});
   }
   if(req.method==='GET'&&path==='/invoices')return send(res,200,{ok:true,invoices:svc.invoices(id,url.searchParams.get('orgId'))});
   if(req.method==='POST'&&path==='/invoices'){const b=await jsonBody(req);return send(res,201,{ok:true,invoice:svc.createInvoice(id,b.orgId)})}
   if(req.method==='POST'&&path==='/billing/stripe-test/intent'){
    assert(mode==='stripe_test'&&!prod,503,'Stripe test intents disabled');
    const b=await jsonBody(req);
    assert(typeof b.invoiceId==='string',422,'Invoice ID required');
    const invoice=db.prepare('SELECT * FROM invoices WHERE id=? AND user_id=?').get(b.invoiceId,id);
    assert(invoice&&!db.prepare('SELECT 1 FROM invoice_voids WHERE invoice_id=?').get(b.invoiceId),404,'Payable invoice not found');
    svc.member(id,invoice.org_id,['owner']);
    const intent=await createStripeTestIntent(invoice,{secretKey:stripeSecretKey,fetchFn:stripeFetch});
    // Persist only the provider's stable identifier. The client secret is not a ledger entry.
    const existing=db.prepare('SELECT external_id FROM provider_intents WHERE invoice_id=?').get(invoice.id);
    assert(!existing||existing.external_id===intent.intentId,409,'Conflicting payment intent','INTENT_COLLISION');
    if(!existing)db.prepare('INSERT INTO provider_intents(invoice_id,provider,external_id,created_at) VALUES(?,?,?,?)').run(invoice.id,'STRIPE_TEST',intent.intentId,new Date().toISOString());
    return send(res,200,{ok:true,intent});
   }
   if(req.method==='POST'&&path==='/billing/stripe-test/checkout'){
    assert(mode==='stripe_test'&&!prod,503,'Test checkout disabled');
    const b=await jsonBody(req);assert(typeof b.invoiceId==='string',422,'Invoice ID required');
    const invoice=db.prepare('SELECT * FROM invoices WHERE id=? AND user_id=?').get(b.invoiceId,id);
    assert(invoice&&!db.prepare('SELECT 1 FROM invoice_voids WHERE invoice_id=?').get(b.invoiceId),404,'Invoice not payable');
    svc.member(id,invoice.org_id,['owner']);
    const session=await createStripeTestCheckout(invoice,{secretKey:stripeSecretKey,fetchFn:stripeFetch,origin});
    svc.recordCheckoutSession(id,invoice.id,session);
    return send(res,200,{ok:true,checkout:session,note:'Stripe TEST hosted checkout. No live funds'});
   }
   if(req.method==='POST'&&path==='/admin/provider/stripe-test/verify'){
    assert(mode==='stripe_test'&&!prod,503,'Test provider verification disabled');
    svc.admin(id);const b=await jsonBody(req);
    assert(typeof b.paymentExternalId==='string',422,'Payment reference required');
    const payment=db.prepare("SELECT * FROM payments WHERE external_id=? AND provider='STRIPE_TEST'").get(b.paymentExternalId);
    assert(payment,404,'Test payment not found');
    const report=await verifyStripeTestSettlement(payment,{secretKey:stripeSecretKey,fetchFn:stripeFetch});
    return send(res,200,{ok:true,verification:svc.recordProviderVerification(id,payment.external_id,report)});
   }
   if(req.method==='POST'&&path==='/sandbox/pay'){
    assert(mode==='sandbox'&&!prod,403,'Sandbox payments disabled');const b=await jsonBody(req);
    const invoice=svc.invoices(id,b.orgId).find(x=>x.id===b.invoiceId);
    assert(invoice,404,'Invoice not found');
    const item=svc.db.prepare('SELECT * FROM invoices WHERE id=? AND user_id=?').get(b.invoiceId,id);
    assert(item,403,'Only invoice buyer can simulate payment');
    const event={id:'sandbox_evt_'+crypto.randomUUID(),type:'payment.succeeded',provider:'SANDBOX_NO_REAL_MONEY',invoiceId:item.id,externalId:'sandbox_pay_'+crypto.randomUUID(),amountCents:item.total_cents,currency:'RUB'};
    return send(res,200,{ok:true,demo:true,result:svc.processPaymentEvent(event)});
   }
   if(req.method==='POST'&&path==='/sandbox/refund'){
    assert(mode==='sandbox'&&!prod,403,'Sandbox refunds disabled');adminRoute(id);const b=await jsonBody(req);
    const p=svc.db.prepare('SELECT * FROM payments WHERE external_id=?').get(b.paymentExternalId);
    assert(p,404,'Payment not found');
    const event={id:'sandbox_ref_evt_'+crypto.randomUUID(),type:'payment.refunded',provider:'SANDBOX_NO_REAL_MONEY',paymentExternalId:p.external_id,externalId:'sandbox_ref_'+crypto.randomUUID(),amountCents:b.amountCents};
    return send(res,200,{ok:true,demo:true,result:svc.processPaymentEvent(event)});
   }
   if(req.method==='GET'&&path==='/referrals/me')return send(res,200,{ok:true,...svc.rewards(id),referralUrl:`${origin}/?ref=${encodeURIComponent(svc.rewards(id).code)}`});
   if(req.method==='POST'&&path==='/referrals/payouts'){
    const b=await jsonBody(req);return send(res,201,{ok:true,...svc.requestPayout(id,b.amountCents)});
   }
   if(req.method==='GET'&&path==='/referrals/payouts')return send(res,200,{ok:true,requests:svc.payoutRequests(id)});
   if(req.method==='GET'&&path==='/disputes')return send(res,200,{ok:true,disputes:svc.disputes(id,url.searchParams.get('orgId'))});
   if(req.method==='POST'&&path==='/disputes'){const b=await jsonBody(req);return send(res,201,{ok:true,...svc.createDispute(id,b.orgId,b.subject,b.detail)})}
   if(req.method==='GET'&&path==='/admin')return send(res,200,{ok:true,...svc.adminDashboard(id),cases:svc.adminLists(id)});
   if(req.method==='GET'&&path==='/admin/audit')return send(res,200,{ok:true,events:svc.auditRecent(id)});
   if(req.method==='GET'&&path==='/admin/settlements')return send(res,200,{ok:true,reports:svc.settlementReports(id)});
   if(req.method==='POST'&&path==='/admin/settlements'){
    const b=await jsonBody(req,256*1024);return send(res,200,{ok:true,result:svc.reconcileSettlements(id,b)});
   }
   m=path.match(/^\/admin\/referrals\/([\w-]+)\/recheck$/);
   if(req.method==='POST'&&m)return send(res,200,{ok:true,risk:svc.recheckReferral(id,m[1])});
   if(req.method==='POST'&&path==='/admin/referrals/settle')return send(res,200,{ok:true,...svc.settleRewards(id)});
   m=path.match(/^\/admin\/(fraud|disputes|payouts)\/([\w-]+)\/review$/);
   if(req.method==='POST'&&m){
    const b=await jsonBody(req);const result=m[1]==='fraud'?svc.reviewFraud(id,m[2],b.status):m[1]==='disputes'?svc.reviewDispute(id,m[2],b.status,b.resolution):svc.reviewPayout(id,m[2],b.status);
    return send(res,200,{ok:true,...result});
   }
   throw new HttpError(404,'Route not found');
  }catch(err){
   const status=err instanceof HttpError?err.status:500;
   if(status===500)console.error('[server error]',err);
   return send(res,status,{ok:false,error:status===500?'Internal server error':err.message,code:err.code||'INTERNAL'});
  }
 });
 return {server,db,svc,mode,metrics};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const port=Number(process.env.PORT||3100),host=process.env.HOST||'127.0.0.1';
 const {server,mode}=createHttpServer();server.listen(port,host,()=>console.log(`OSMANX PROOF R5 at http://${host}:${port} | Payment mode: ${mode}`));
}
