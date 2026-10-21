import{A as e,G as t,J as n,P as r,_ as i,ot as a,v as o}from"./db-kf_TeMKT.js";import{n as s}from"./blocks-B-M8VP77.js";function c(e){return a.raw(`'${e}'`)}function l(t){return a`(
        exists (
          select 1 from ${i} as f
          where f.follower_id = ${t}
            and f.following_id = ${r.authorId}
            and ${r.pageId} is null
        )
        or exists (
          select 1 from ${e} as pf
          where pf.user_id = ${t} and pf.page_id = ${r.pageId}
        )
      )`}function u(e){return a`(
        exists (
          select 1 from ${o} as gm
          where gm.group_id = ${r.groupId} and gm.user_id = ${e}
        )
      )`}function d(e,n){let i=t[e];return i.admitsAnyone?a`${r.visibility} = ${c(e)}`:i.requiresFollow?a`(
      ${r.visibility} = ${c(e)}
      and ${l(n)}
    )`:i.requiresGroupMembership?a`(
      ${r.visibility} = ${c(e)}
      and ${u(n)}
    )`:null}function f(e){let i=Object.keys(t).map(t=>d(t,e)).filter(e=>e!==null);return n(a`${r.deletedAt} IS NULL`,a`(
      ${r.authorId} = ${e}
      or ${a.join(i,a`\n      or `)}
    )`,s(e,r.authorId))}export{f as t};