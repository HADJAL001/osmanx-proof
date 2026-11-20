import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
// Integer RUB cents only; assumptions from the R7 public commercial policy, NOT audited costs.
export const packageAssumptions=Object.freeze({
 growth_setup_40k:{priceCents:4_000_000,deliveryCents:1_800_000,commissionMaxRate:0.10,taxReserveRate:0.12,processingReserveRate:0.03},
 enterprise_setup_200k:{priceCents:20_000_000,deliveryCents:10_000_000,commissionMaxRate:0.10,taxReserveRate:0.12,processingReserveRate:0.03},
});
function cents(v,label){if(!Number.isSafeInteger(v)||v<0)throw Error('Invalid nonnegative integer cents: '+label);return v;}
function rate(v,label){if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>1)throw Error('Invalid rate: '+label);return v;}
export function evaluateSale({priceCents,deliveryCents,taxReserveRate=0.12,processingReserveRate=0.03,otherCostCents=0,commissionMaxRate=0.10,partner=false}){
 const gross=cents(priceCents,'priceCents'),delivery=cents(deliveryCents,'deliveryCents'),other=cents(otherCostCents,'otherCostCents');
 const tax=Math.ceil(gross*rate(taxReserveRate,'taxReserveRate'));
 const processing=Math.ceil(gross*rate(processingReserveRate,'processingReserveRate'));
 const capRate=rate(commissionMaxRate,'commissionMaxRate');
 const preCommission=gross-delivery-other-tax-processing;
 const rateCap=Math.floor(gross*capRate),marginCap=Math.floor(Math.max(0,preCommission)*0.35);
 const commissionCents=partner?Math.min(rateCap,marginCap):0;
 const contributionCents=preCommission-commissionCents;
 return {grossCents:gross,deliveryCents:delivery,taxReserveCents:tax,processingReserveCents:processing,otherCostCents:other,
  preCommissionCents:preCommission,commissionCents,contributionCents,distributable:preCommission>0,
  assumptionsUnverified:true,realPayout:false,
  warnings:[...(preCommission<=0?['Negative or zero margin: do not pay commission']:[]),
   'Commission is only for fulfilled retail services after verified payment, client acceptance and cooling period',
   'No purchase or recruiting quota required to become a partner'],
 };
}
export function forecastMix(mix,{partnerShare=0,overrides={}}={}){
 rate(partnerShare,'partnerShare');
 const rows=[];let sales=0,turnover=0,estimatedContribution=0,commission=0;
 for(const [sku,count] of Object.entries(mix)){
  if(!Object.hasOwn(packageAssumptions,sku))throw Error('Unknown product '+sku);
  if(!Number.isSafeInteger(count)||count<0||count>10000)throw Error('Invalid sale count '+sku);
  const setup={...packageAssumptions[sku],...(overrides[sku]??{})};
  const direct=evaluateSale({...setup,partner:false}),referred=evaluateSale({...setup,partner:true});
  const referredSales=Math.floor(count*partnerShare),directSales=count-referredSales;
  turnover+=count*direct.grossCents;
  estimatedContribution+=directSales*direct.contributionCents+referredSales*referred.contributionCents;
  commission+=referredSales*referred.commissionCents;sales+=count;
  rows.push({sku,count,referredSales,revenueCents:count*direct.grossCents,estimatedContributionCents:directSales*direct.contributionCents+referredSales*referred.contributionCents,commissionCents:referredSales*referred.commissionCents});
 }
 return {scenarioOnly:true,realOrdersObserved:0,realProfitVerified:false,sales,turnoverCents:turnover,estimatedContributionCents:estimatedContribution,commissionCents:commission,rows};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const obj={growth:evaluateSale({...packageAssumptions.growth_setup_40k,partner:true}),enterprise:evaluateSale({...packageAssumptions.enterprise_setup_200k,partner:true}),pilot20:forecastMix({growth_setup_40k:15,enterprise_setup_200k:5},{partnerShare:0.2})};
 console.log(JSON.stringify(obj,null,2));
}
