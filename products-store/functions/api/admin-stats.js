import {adminAuthorized,mutationGuard} from "../_shared/security.js";
import {supabaseDB} from "../_shared/supabase-db.js";
import {listPublishedSupabaseProducts} from "../_shared/supabase-products.js";
export async function onRequestGet({request,env}) {
  const token=request.headers.get("x-admin-token")||"";
  if(!env.ADMIN_PASSWORD||token!==env.ADMIN_PASSWORD) return Response.json({error:"Admin authentication failed."},{status:401});
  try {
    const {results=[]}=await supabaseDB(env).prepare(`
      SELECT p.slug,p.title,p.price,p.status,p.created_at,
        COALESCE((SELECT COUNT(*) FROM product_events e WHERE e.product_slug=p.slug AND e.event_type='view'),0) AS views,
        COALESCE((SELECT COUNT(*) FROM product_events e WHERE e.product_slug=p.slug AND e.event_type='click'),0) AS clicks,
        COALESCE((SELECT COUNT(*) FROM product_orders o WHERE o.product_slug=p.slug AND o.status='COMPLETED'),0) AS sales,
        COALESCE((SELECT SUM(CAST(o.amount AS REAL)) FROM product_orders o WHERE o.product_slug=p.slug AND o.status='COMPLETED'),0) AS revenue
      FROM products p
      WHERE p.status='published'
      ORDER BY revenue DESC, sales DESC, p.created_at DESC
    `).all();
    const supabaseProducts=await listPublishedSupabaseProducts(env);
    const seen=new Set(results.map(p=>p.slug));
    const allProducts=[...results,...supabaseProducts.filter(p=>!seen.has(p.slug)).map(p=>({...p,views:0,clicks:0,sales:0,revenue:0}))];
    const products=allProducts.map(p=>({...p,price:Number(p.price||0),views:Number(p.views||0),clicks:Number(p.clicks||0),sales:Number(p.sales||0),revenue:Number(p.revenue||0)}));
    const summary=products.reduce((a,p)=>({sales:a.sales+p.sales,revenue:a.revenue+p.revenue,views:a.views+p.views,clicks:a.clicks+p.clicks}),{sales:0,revenue:0,views:0,clicks:0});
    const {results:recentOrders=[]}=await supabaseDB(env).prepare(`
      SELECT o.paypal_order_id,o.product_slug,p.title,o.amount,o.currency,o.status,o.paid_at
      FROM product_orders o LEFT JOIN products p ON p.slug=o.product_slug
      WHERE o.status='COMPLETED'
      ORDER BY COALESCE(o.paid_at,o.created_at) DESC LIMIT 20
    `).all();
    return Response.json({products,summary,recentOrders,salesTracking:true});
  } catch(e) {
    return Response.json({error:"Could not load sales analytics. "+e.message},{status:500});
  }
}