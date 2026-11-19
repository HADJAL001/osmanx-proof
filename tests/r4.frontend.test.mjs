import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {safeAuthenticatedRelayPath,safeReviewToken,safeCheckoutUrl} from '../web-next/lib/proxy-policy.mjs';
const root=fileURLToPath(new URL('../web-next/',import.meta.url));
test('R4 NEXT 01: authenticated Next proxy excludes webhooks and public reply',()=>{
 for(const path of [['webhooks','stripe-test'],['webhooks','payments'],['public','quotes','token','respond'],['admin','provider','stripe-test','verify'],['compliance','email','confirm']])
 assert.equal(safeAuthenticatedRelayPath(path),false);
});
test('R4 NEXT 02: authenticated Next proxy keeps core app API paths',()=>{
 for(const path of [['me'],['auth','register'],['invoices'],['quotes','uuid_123','share'],['compliance','payout','tax'],['billing','stripe-test','checkout']])
 assert.equal(safeAuthenticatedRelayPath(path),true);
});
test('R4 NEXT 03: rejects encoded paths, dot-slash traversal and oversized segments',()=>{
 for(const path of [['..'],['a/b'],['file%2fsecret'],['a'.repeat(129)],Array.from({length:8},()=> 'x'),[]])
 assert.equal(safeAuthenticatedRelayPath(path),false);
});
test('R4 NEXT 04: public quote reply requires securely shaped single-use link token',()=>{
 assert.equal(safeReviewToken('A'.repeat(43)),true);
 for(const bad of ['a','..','javascript:alert(1)','a'.repeat(201),'valid/slash'])assert.equal(safeReviewToken(bad),false);
});
test('R4 NEXT 05: hosted test checkout URL only accepts Stripe-controlled host',()=>{
 assert.equal(safeCheckoutUrl('https://checkout.stripe.com/c/pay/cs_test_demo'),true);
 for(const bad of ['http://checkout.stripe.com/pay','https://checkout.stripe.com.evil.test/pay','javascript:alert(1)','https://evil.test','https://user:pass@checkout.stripe.com/c/pay/test'])assert.equal(safeCheckoutUrl(bad),false);
});
test('R4 NEXT 06: Next route files include public quote response, print assets and signed auth proxy',()=>{
 for(const rel of ['app/api/public/quotes/[token]/respond/route.ts','app/s/[token]/route.ts','app/print.css/route.ts','app/print.js/route.ts','app/review.js/route.ts','app/api/proof/[...path]/route.ts'])
 assert.equal(existsSync(join(root,rel)),true,rel);
 const reply=readFileSync(join(root,'app/api/public/quotes/[token]/respond/route.ts'),'utf8');
 assert.match(reply,/safeReviewToken/);assert.match(reply,/origin&&origin!==publicOrigin/);assert.match(reply,/raw.byteLength>8192/);
});
test('R4 NEXT 07: UI exposes Stripe-test hosted checkout & payout tax workflow (not live money)',()=>{
 const source=readFileSync(join(root,'components/WorkspaceApp.tsx'),'utf8');
 for(const value of ['Stripe test checkout','/billing/stripe-test/checkout','/compliance/payout/tax','/compliance/payout/terms','realTransfer'])
 if(value==='realTransfer')assert.doesNotMatch(source,/realTransfer:\s*true/);
 else assert.ok(source.includes(value),value);
});
test('R4 NEXT 08: pure TypeScript quote maths execute with native Node type stripping',()=>{
 const code=`import {quoteTotals} from ${JSON.stringify('file://'+join(root,'lib/finance.ts'))};const a=quoteTotals([{description:'a',qty:2,unitPriceCents:10000,unitCostCents:3000}],1000,2000);if(a.totalCents!==22800||a.profitCents!==13000)process.exit(3);`;
 assert.doesNotThrow(()=>execFileSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',code],{stdio:'pipe'}));
});
