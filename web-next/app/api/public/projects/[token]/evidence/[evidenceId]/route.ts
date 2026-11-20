import {NextRequest,NextResponse} from 'next/server';
export const dynamic='force-dynamic';
export async function GET(_req:NextRequest,{params}:{params:Promise<{token:string;evidenceId:string}>}){
 const {token,evidenceId}=await params;
 if(!/^[A-Za-z0-9_-]{30,200}$/.test(token)||!/^[0-9a-f-]{36}$/.test(evidenceId))return NextResponse.json({error:'Invalid link'},{status:404});
 const base=process.env.BACKEND_URL||'http://127.0.0.1:3100';
 try{
  const url=new URL(`/api/public/projects/${encodeURIComponent(token)}/evidence/${encodeURIComponent(evidenceId)}`,base);
  const r=await fetch(url,{cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(12000)});
  const headers=new Headers({'cache-control':'private, no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-robots-tag':'noindex,nofollow'});
  for(const name of ['content-type','content-disposition','content-length','cross-origin-resource-policy']){
   const value=r.headers.get(name);if(value)headers.set(name,value);
  }
  return new NextResponse(await r.arrayBuffer(),{status:r.status,headers});
 }catch{return NextResponse.json({error:'Evidence unavailable'},{status:502,headers:{'cache-control':'no-store'}})}
}
