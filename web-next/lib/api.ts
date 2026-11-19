export class ProofApiError extends Error {constructor(public status:number, message:string){super(message)}}
export async function proofApi<T>(path:string,{method='GET',body,csrf}:{method?:string;body?:unknown;csrf?:string}={}):Promise<T>{
 if(!/^\/[A-Za-z0-9_/?=&.%-]*$/.test(path)||path.includes('..'))throw Error('Invalid API path');
 const r=await fetch('/api/proof'+path,{method,credentials:'same-origin',cache:'no-store',headers:{...(body?{'content-type':'application/json'}:{}),...(csrf?{'x-csrf-token':csrf}:{})},body:body?JSON.stringify(body):undefined});
 const result:unknown=await r.json();if(!r.ok)throw new ProofApiError(r.status,(result&&typeof result==='object'&&'error'in result)?String((result as {error:unknown}).error):'Request failed');
 return result as T;
}
