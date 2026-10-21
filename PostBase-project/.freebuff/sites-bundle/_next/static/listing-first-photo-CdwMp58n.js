import{T as e,ot as t,w as n}from"./db-kf_TeMKT.js";function r(){return t`(
    select lm.url from ${n} as lm
    where lm.listing_id = ${e.id}
    order by lm."order" asc
    limit 1
  )`}export{r as t};