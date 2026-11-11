const DEFAULT_URL="https://ssnjoflgkkimrcapeglg.supabase.co";
export function supabaseDB(env){
  const url=String(env.SUPABASE_URL||DEFAULT_URL).replace(/\/$/,"");
  const key=String(env.SUPABASE_SERVICE_ROLE_KEY||"");
  if(!key)throw new Error("Supabase service role key is not configured.");
  async function execute(sql,params=[]){
    const response=await fetch(url+"/rest/v1/rpc/digitalnest_d1_query",{method:"POST",headers:{apikey:key,Authorization:"Bearer "+key,"Content-Type":"application/json"},body:JSON.stringify({p_sql:sql,p_params:params})});
    if(!response.ok)throw new Error("Supabase database request failed ("+response.status+"): "+(await response.text()).slice(0,400));
    const result=await response.json();
    return {results:Array.isArray(result.results)?result.results:[],meta:{changes:Number(result.changes||0)}};
  }
  return {prepare(sql){let params=[];const statement={bind(...values){params=values;return statement;},async all(){return execute(sql,params);},async first(){const r=await execute(sql,params);return r.results[0]||null;},async run(){const r=await execute(sql,params);return {meta:r.meta,success:true};}};return statement;}};
}
