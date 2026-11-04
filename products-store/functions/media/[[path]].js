const MIME_TYPES={jpg:"image/jpeg",jpeg:"image/jpeg",png:"image/png",webp:"image/webp",svg:"image/svg+xml"};
export async function onRequest({params,env}){
 const parts=Array.isArray(params.path)?params.path:[String(params.path||"")];
 const key=parts.join("/");
 if(!key.startsWith("covers/")||parts.some(p=>!p||p==="."||p===".."))return new Response("Not found",{status:404});
 const obj=await env.FILES?.get(key);
 if(!obj)return new Response("Not found",{status:404});
 const headers=new Headers();
 obj.writeHttpMetadata(headers);
 const ext=key.split(".").pop().toLowerCase();
 const mime=MIME_TYPES[ext]||"application/octet-stream";
 const current=headers.get("content-type")||"";
 if(!current||current==="application/octet-stream"||current==="binary/octet-stream")headers.set("content-type",mime);
 headers.set("etag",obj.httpEtag);
 headers.set("cache-control","public, max-age=86400");
 headers.set("x-content-type-options","nosniff");
 return new Response(obj.body,{headers});
}