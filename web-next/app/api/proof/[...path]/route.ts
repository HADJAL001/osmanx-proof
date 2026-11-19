import {safeAuthenticatedRelayPath} from '../../../../lib/proxy-policy.mjs';
import { NextRequest, NextResponse } from 'next/server';
export const dynamic='force-dynamic';
const base=process.env.BACKEND_URL||'http://127.0.0.1:3100';
async function handle(req:NextRequest,{params}:{params:Promise<{path:string[]}>}){
 const {path}=await params;
 if(!safeAuthenticatedRelayPath(path))return NextResponse.json({ok:false,error:'Invalid path'},{status:400});
 const url=new URL('/api/'+path.map(encodeURIComponent).join('/'),base);url.search=req.nextUrl.search;
 const headers=new Headers();const cookie=req.headers.get('cookie');const csrf=req.headers.get('x-csrf-token');const contentType=req.headers.get('content-type');
 if(cookie)headers.set('cookie',cookie);if(csrf)headers.set('x-csrf-token',csrf);if(contentType)headers.set('content-type',contentType);
 headers.set('origin',process.env.APP_ORIGIN||'http://127.0.0.1:3000');
 try{
  const upstream=await fetch(url,{method:req.method,headers,body:['GET','HEAD'].includes(req.method)?undefined:await req.arrayBuffer(),cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(12000)});
  const outgoing=new Headers();const setCookie=upstream.headers.get('set-cookie');if(setCookie)outgoing.set('set-cookie',setCookie);
  outgoing.set('content-type',upstream.headers.get('content-type')||'application/json');outgoing.set('cache-control','no-store');
  return new NextResponse(await upstream.arrayBuffer(),{status:upstream.status,headers:outgoing});
 }catch{return NextResponse.json({ok:false,error:'Backend unavailable'},{status:502})}
}
export {handle as GET,handle as POST,handle as PATCH,handle as DELETE};
