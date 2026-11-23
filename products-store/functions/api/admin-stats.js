import {adminAuthorized} from "../_shared/security.js";
import {supabaseDB} from "../_shared/supabase-db.js";
import {listPublishedSupabaseProducts} from "../_shared/supabase-products.js";

export async function onRequestGet({request,env}) {
  if(!adminAuthorized(request,env)) {
    return Response.json({error:"Admin authentication failed."},{status:401});
  }

  try {
    const db=supabaseDB(env);

    // Keep each read query simple for the Supabase-backed D1 compatibility RPC.
    // Aggregate traffic and payments separately instead of using correlated
    // subqueries against products (which can fail in the compatibility layer).
    const {results:storedProducts=[]}=await db.prepare(`
      SELECT slug,title,price,status,created_at
      FROM products
      WHERE status='published'
      ORDER BY created_at DESC
    `).all();

    const supabaseProducts=await listPublishedSupabaseProducts(env);
    const seen=new Set(storedProducts.map(p=>p.slug));
    const allProducts=[
      ...storedProducts,
      ...supabaseProducts.filter(p=>!seen.has(p.slug)).map(p=>({...p,views:0,clicks:0,sales:0,revenue:0}))
    ];

    const {results:eventTotals=[]}=await db.prepare(`
      SELECT product_slug,event_type,COUNT(*) AS total
      FROM product_events
      GROUP BY product_slug,event_type
    `).all();

    const {results:orderTotals=[]}=await db.prepare(`
      SELECT product_slug,COUNT(*) AS sales,SUM(CAST(amount AS REAL)) AS revenue
      FROM product_orders
      WHERE status='COMPLETED'
      GROUP BY product_slug
    `).all();

    const eventMap=new Map();
    for(const row of eventTotals) {
      const current=eventMap.get(row.product_slug)||{views:0,clicks:0};
      if(row.event_type==='view') current.views=Number(row.total||0);
      if(row.event_type==='click') current.clicks=Number(row.total||0);
      eventMap.set(row.product_slug,current);
    }
    const orderMap=new Map(orderTotals.map(row=>[
      row.product_slug,
      {sales:Number(row.sales||0),revenue:Number(row.revenue||0)}
    ]));

    const products=allProducts.map(p=>{
      const events=eventMap.get(p.slug)||{};
      const orders=orderMap.get(p.slug)||{};
      return {
        ...p,
        price:Number(p.price||0),
        views:Number(p.views??events.views??0),
        clicks:Number(p.clicks??events.clicks??0),
        sales:Number(p.sales??orders.sales??0),
        revenue:Number(p.revenue??orders.revenue??0)
      };
    });

    const summary=products.reduce((a,p)=>({
      sales:a.sales+p.sales,
      revenue:a.revenue+p.revenue,
      views:a.views+p.views,
      clicks:a.clicks+p.clicks
    }),{sales:0,revenue:0,views:0,clicks:0});

    const {results:recentOrders=[]}=await db.prepare(`
      SELECT paypal_order_id,product_slug,amount,currency,status,paid_at,created_at
      FROM product_orders
      WHERE status='COMPLETED'
      ORDER BY paid_at DESC
      LIMIT 20
    `).all();

    const titleBySlug=new Map(products.map(p=>[p.slug,p.title]));
    const orders=recentOrders.map(o=>({...o,title:titleBySlug.get(o.product_slug)||o.product_slug}));

    products.sort((a,b)=>b.revenue-a.revenue||b.sales-a.sales||String(b.created_at||'').localeCompare(String(a.created_at||'')));

    return Response.json({products,summary,recentOrders:orders,salesTracking:true});
  } catch(e) {
    console.error("ADMIN_STATS_LOAD_FAILED",e);
    return Response.json({
      error:"تعذر تحميل إحصائيات المبيعات والزيارات.",
      diagnostic: String(e?.message||e).slice(0,500)
    },{status:500});
  }
}
