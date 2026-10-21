import{J as e,L as t,P as n,et as r,ot as i,p as a,r as o,t as s}from"./db-kf_TeMKT.js";import{a as c,n as l,o as u}from"./api-helpers-Btorluec.js";import{i as d}from"./cursor-pagination-C8TKnIFZ.js";import{t as f}from"./post-visibility-x1mFxlMp.js";var p=100;async function m(m){let{session:h,error:g}=await c(m);if(g)return g;let _=new URL(m.url).searchParams.get(`ids`)??``,v=[...new Set(_.split(`,`).map(e=>e.trim()).filter(Boolean))];if(v.length===0)return l(`At least one id is required`,400);if(v.length>p)return l(`At most ${p} ids can be looked up at once`,400);if(v.some(e=>!d(e)))return l(`Invalid ids`,400);try{let c=await o(()=>s.select({id:n.id,commentCount:i`(
            select count(*)::int from ${a} as c
            where c.post_id = "posts"."id" and c.deleted_at is null
          )`,reactionCount:i`(
            select count(*)::int from ${t} as r
            where r.target_type = 'post' and r.target_id = "posts"."id"
          )`}).from(n).where(e(r(n.id,v),i`${n.deletedAt} IS NULL`,f(h.user.id))));return u({data:c})}catch(e){return console.error(`Get post counts error:`,e),l(`Failed to fetch post counts`,500)}}export{m as GET};