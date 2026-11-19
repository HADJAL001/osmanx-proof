import { randomBytes, createHash, scryptSync, timingSafeEqual, createHmac } from 'node:crypto';
export const newId = () => crypto.randomUUID();
export const token = () => randomBytes(32).toString('base64url');
export const sha = input => createHash('sha256').update(String(input)).digest('hex');
export const now = () => new Date().toISOString();
export function passwordHash(pwd) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt:${salt}:${scryptSync(pwd,salt,64).toString('hex')}`;
}
export function verifyPassword(pwd,stored) {
  try {
    const [algo,salt,h]=stored.split(':'); if(algo!=='scrypt') return false;
    const a=Buffer.from(h,'hex'), b=scryptSync(pwd,salt,a.length);
    return a.length===b.length && timingSafeEqual(a,b);
  } catch { return false; }
}
export function signWebhook(body,timestamp,secret) {
  return createHmac('sha256',secret).update(`${timestamp}.${body}`).digest('hex');
}
export function verifyWebhook(body,timestamp,signature,secret,clock=Date.now()) {
  if (!secret || !/^\d+$/.test(timestamp || '') || !/^[0-9a-f]{64}$/i.test(signature || '')) return false;
  if (Math.abs(clock-Number(timestamp)*1000)>300_000) return false;
  const given=Buffer.from(signature,'hex'), expected=Buffer.from(signWebhook(body,timestamp,secret),'hex');
  return given.length===expected.length && timingSafeEqual(given,expected);
}
export function isoAddDays(date,days){ return new Date(new Date(date).getTime()+days*86400000).toISOString(); }
export function isoAddMonths(date,months){ const d = new Date(date); const orig=d.getUTCDate(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth()+months); const max=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate(); d.setUTCDate(Math.min(orig,max)); return d.toISOString(); }
export function cleanText(input,max=120){ return String(input??'').trim().slice(0,max); }
export class HttpError extends Error { constructor(status,message,code='BAD_REQUEST'){super(message);this.status=status;this.code=code;} }
export const assert = (condition,status,message,code)=>{if(!condition) throw new HttpError(status,message,code);};
export function jsonParseSafe(raw){try{return JSON.parse(raw)}catch{throw new HttpError(400,'Invalid JSON','INVALID_JSON')}}
