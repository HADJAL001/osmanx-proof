import { assert } from './security.mjs';
const MAX=Number.MAX_SAFE_INTEGER;
export function isCents(n){return Number.isSafeInteger(n)&&n>=0&&n<=100_000_000_000;}
export function quoteMath(items,discountCents=0,taxBps=0){
 assert(Array.isArray(items)&&items.length>0&&items.length<=40,422,'Quote requires 1–40 lines');
 assert(isCents(discountCents)&&Number.isSafeInteger(taxBps)&&taxBps>=0&&taxBps<=10000,422,'Invalid discount or tax');
 let subtotal=0,cost=0;
 const lines=items.map((x,i)=>{
  assert(typeof x.description==='string'&&x.description.trim().length>0&&x.description.length<=180,422,'Invalid line description');
  assert(Number.isSafeInteger(x.qty)&&x.qty>=1&&x.qty<=10000&&isCents(x.unitPriceCents)&&isCents(x.unitCostCents),422,'Invalid line amount');
  const price=x.qty*x.unitPriceCents, expenses=x.qty*x.unitCostCents;
  assert(Number.isSafeInteger(price)&&Number.isSafeInteger(expenses),422,'Overflow');
  subtotal+=price;cost+=expenses;assert(subtotal<=MAX&&cost<=MAX,422,'Overflow');
  return {position:i+1,description:x.description.trim(),qty:x.qty,unitPriceCents:x.unitPriceCents,unitCostCents:x.unitCostCents,lineTotalCents:price};
 });
 assert(discountCents<=subtotal,422,'Discount exceeds subtotal');
 const taxable=subtotal-discountCents, taxCents=Math.round(taxable*taxBps/10000),total=subtotal-discountCents+taxCents;
 assert(Number.isSafeInteger(total),422,'Overflow');
 return {lines,subtotalCents:subtotal,costCents:cost,discountCents,taxBps,taxCents,totalCents:total,estimatedProfitCents:taxable-cost,estimatedMarginPercent:taxable>0?Math.round((taxable-cost)*10000/taxable)/100:0};
}
export const PRO_PRICE_CENTS=129000;
export const PRO_COST_CENTS=29000;
export const TAX_RESERVE_BPS=1200;
export const MAX_REWARD_CENTS=25000;
export function invoicePrice(firstEligible){
 const discountCents=firstEligible?Math.round(PRO_PRICE_CENTS*0.10):0;
 return {listAmountCents:PRO_PRICE_CENTS,discountCents,totalCents:PRO_PRICE_CENTS-discountCents};
}
export function calculateReward(amountCents) {
 assert(isCents(amountCents),422,'Invalid amount');
 const contribution=Math.max(0,Math.floor(amountCents*(10000-TAX_RESERVE_BPS)/10000)-PRO_COST_CENTS);
 return Math.max(0,Math.min(Math.round(amountCents*0.10),MAX_REWARD_CENTS,Math.floor(contribution*0.30)));
}
export function ledgerBalanced(entries){
 if(!Array.isArray(entries)||entries.length<2) return false;
 let d=0,c=0;
 for(const e of entries){if(!isCents(e.debitCents)||!isCents(e.creditCents)||(e.debitCents>0)===(e.creditCents>0))return false;d+=e.debitCents;c+=e.creditCents;}
 return d===c&&d>0&&Number.isSafeInteger(d);
}
