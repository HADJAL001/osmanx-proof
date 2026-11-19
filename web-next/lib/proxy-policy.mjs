// Pure validation helpers shared by Next routes and Node regression tests.
const forbidden=[/^webhooks(?:\/|$)/,/^public(?:\/|$)/,/^admin\/provider\//,/^compliance\/email\/confirm$/];
export function safeAuthenticatedRelayPath(path){
 if(!Array.isArray(path)||path.length===0||path.length>7)return false;
 if(!path.every(x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(x)))return false;
 return !forbidden.some(x=>x.test(path.join('/')));
}
export function safeReviewToken(token){return typeof token==='string'&&/^[A-Za-z0-9_-]{30,200}$/.test(token)}
export function safeCheckoutUrl(raw){try{const url=new URL(raw);return url.protocol==='https:'&&url.hostname==='checkout.stripe.com'&&url.username===''&&url.password===''}catch{return false}}
