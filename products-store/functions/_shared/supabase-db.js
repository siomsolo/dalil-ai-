const DEFAULT_URL="https://ssnjoflgkkimrcapeglg.supabase.co";
export function supabaseDB(env){
  const url=String(env.SUPABASE_URL||DEFAULT_URL).replace(/\/$/,"");
  const key=String(env.SUPABASE_SERVICE_ROLE_KEY||"");
  if(!key)throw new Error("Supabase service role key is not configured.");
  async function execute(sql,params=[]){
    const readOnly=/^\s*(SELECT|WITH)\b/i.test(sql);
    let lastError=null;
    // A transiently truncated RPC response is safe to retry only for read-only SQL.
    for(let attempt=0;attempt<(readOnly?2:1);attempt++){
      const response=await fetch(url+"/rest/v1/rpc/digitalnest_d1_query",{method:"POST",headers:{apikey:key,Authorization:"Bearer "+key,"Content-Type":"application/json"},body:JSON.stringify({p_sql:sql,p_params:params})});
      const raw=await response.text();
      if(!response.ok)throw new Error("Supabase database request failed ("+response.status+"): "+raw.slice(0,400));
      try{
        const result=JSON.parse(raw);
        return {results:Array.isArray(result.results)?result.results:[],meta:{changes:Number(result.changes||0)}};
      }catch(error){
        lastError=error;
        console.log("SUPABASE_RPC_INVALID_JSON",JSON.stringify({readOnly,attempt:attempt+1,status:response.status,contentType:response.headers.get("content-type"),bodyLength:raw.length,sql:sql.slice(0,140)}));
      }
    }
    throw new Error("SUPABASE_RPC_INVALID_JSON: Supabase returned an empty or incomplete JSON response for "+(readOnly?"a read query":"a database operation")+". "+String(lastError?.message||lastError));
  }
  return {prepare(sql){let params=[];const statement={bind(...values){params=values;return statement;},async all(){return execute(sql,params);},async first(){const r=await execute(sql,params);return r.results[0]||null;},async run(){const r=await execute(sql,params);return {meta:r.meta,success:true};}};return statement;}};
}
