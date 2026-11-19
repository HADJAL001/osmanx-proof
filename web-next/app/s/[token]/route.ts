import {NextRequest,NextResponse} from 'next/server';
import {safeReviewToken} from '../../../lib/proxy-policy.mjs';
export const dynamic='force-dynamic';
export async function GET(_req:NextRequest,{params}:{params:Promise<{token:string}>}){
 const {token}=await params;
 if(!safeReviewToken(token))return NextResponse.json({error:'Invalid token'},{status:404});
 const backend=process.env.BACKEND_URL||'http://127.0.0.1:3100';
 try{const r=await fetch(new URL('/s/'+token,backend),{cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(9000)});
  return new NextResponse(await r.arrayBuffer(),{status:r.status,headers:{'content-type':r.headers.get('content-type')||'text/html','cache-control':'no-store','x-robots-tag':'noindex,nofollow','referrer-policy':'no-referrer'}})
 }catch{return NextResponse.json({error:'Unavailable'},{status:502})}
}
