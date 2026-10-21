import{J as e,Y as t,at as n,l as r,ot as i}from"./db-kf_TeMKT.js";function a(i,a){return n(e(t(r.blockerId,i),t(r.blockedId,a)),e(t(r.blockerId,a),t(r.blockedId,i)))}function o(e,t){return i`not exists (
    select 1 from ${r}
    where ${a(e,t)}
  )`}export{o as n,a as t};