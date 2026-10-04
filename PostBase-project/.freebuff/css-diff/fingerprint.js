(()=>{
  // The twenty classes that already had a hand-written rule before this change.
  const KNOWN=new Set(["text-foreground","text-muted-foreground","text-primary","bg-background","bg-card","bg-muted","bg-accent","bg-primary","border-border","border-input","ring-ring","focus-visible:ring-ring","text-accent-foreground","bg-secondary","text-secondary-foreground","text-destructive","bg-destructive","text-destructive-foreground","bg-popover","text-popover-foreground"]);
  // Anything in the token family: the bare names plus every variant/opacity form.
  const FAM=/^(text|bg|border|ring)-(background|foreground|card|card-foreground|popover|popover-foreground|primary|primary-foreground|secondary|secondary-foreground|muted|muted-foreground|accent|accent-foreground|destructive|destructive-foreground|border|input|ring)$/;
  const PROPS=["color","background-color","border-top-color","border-right-color","border-bottom-color","border-left-color","outline-color","--tw-ring-color"];
  const base=(c)=>c.split(":").pop().replace(/\/.*$/,"");
  const propOf=(b,c)=>/^bg-/.test(b)?"background-color":/^border-/.test(b)?"border-top-color":/^ring-/.test(b)?"--tw-ring-color":/^text-/.test(b)?(c.startsWith("placeholder:")?"placeholder::placeholder":"color"):"accent-color";
  const read=(el,p)=>p.endsWith("::placeholder")?getComputedStyle(el,"::placeholder").getPropertyValue(p.slice(0,-"::placeholder".length)):getComputedStyle(el).getPropertyValue(p);
  // Is the *after* stylesheet the one on the page? The rule only exists once the
  // tokens are declared in `@theme`.
  let live=false;
  const walk=(rules)=>{for(const r of rules){if(r.selectorText&&r.selectorText.includes("hover")&&r.selectorText.includes("bg-accent"))live=true;if(r.cssRules)walk(r.cssRules);}};
  for(const sheet of document.styleSheets){try{walk(sheet.cssRules);}catch{}}
  const stable=[];const inert={};let n=0;
  const all=document.querySelectorAll("*");
  for(let i=0;i<all.length;i++){
    const el=all[i];
    const cls=(el.getAttribute("class")||"").split(/\s+/).filter(Boolean);
    const fam=cls.filter((c)=>FAM.test(base(c)));
    if(!fam.length)continue;
    n++;
    const cs=getComputedStyle(el);
    if(fam.every((c)=>KNOWN.has(c))){
      stable.push(i+"|"+fam.join(",")+"|"+PROPS.map((p)=>cs.getPropertyValue(p)).join(";"));
      continue;
    }
    for(const c of fam){
      if(KNOWN.has(c))continue;
      const rec=inert[c]||(inert[c]={n:0,vals:[]});
      rec.n++;
      const v=c.startsWith("placeholder:")?read(el,"color::placeholder"):cs.getPropertyValue(propOf(base(c),c));
      if(!rec.vals.includes(v))rec.vals.push(v);
    }
  }
  const text=stable.join("\n");
  let h=5381;
  for(let i=0;i<text.length;i++)h=((h*33)^text.charCodeAt(i))|0;
  return JSON.stringify({path:location.pathname,live,tokenElements:n,stableElements:stable.length,stableHash:h,inert});
})()
