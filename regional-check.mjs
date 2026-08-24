import { chromium } from 'playwright';
import fs from 'node:fs/promises';

const BASE='https://amitai-new-zealand-trip.amitaywagner.chatgpt.site';
const out={generatedAt:new Date().toISOString(),environment:'github-actions-playwright-chromium',tests:[]};
const browser=await chromium.launch({headless:true});

async function ready(page){
  await page.waitForLoadState('domcontentloaded');
  await page.waitForLoadState('networkidle',{timeout:10000}).catch(()=>{});
  await page.waitForTimeout(1400);
}
function rec(id,success,details={},error=null){out.tests.push({id,success,error,details});}

for(const cfg of [
  {id:'desktop-regional-navigator',url:'/visual-review/pages/desktop-route-satellite',width:1440,height:1000,file:'regional-desktop.png'},
  {id:'mobile-regional-navigator',url:'/visual-review/pages/mobile-route',width:390,height:844,file:'regional-mobile.png'},
]){
  const ctx=await browser.newContext({viewport:{width:cfg.width,height:cfg.height},hasTouch:cfg.width<600});
  const page=await ctx.newPage();
  try{
    await page.goto(BASE+cfg.url,{timeout:60000}); await ready(page);
    const body=await page.locator('body').innerText();
    const heading=page.getByText('אזורים במסלול',{exact:true}).first();
    const headingVisible=await heading.isVisible().catch(()=>false);
    const names=['קורומנדל','רוטורואה וטאופו','טרנאקי','טונגרירו','מפרץ הוק'];
    const visibleNames={};
    for(const n of names) visibleNames[n]=await page.getByText(n,{exact:true}).first().isVisible().catch(()=>false);
    const oldStaticSignals=await page.evaluate(()=>{
      const visible=el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0};
      const imgs=[...document.querySelectorAll('img')].filter(visible).map(el=>{const r=el.getBoundingClientRect();return{top:r.top,height:r.height,width:r.width,alt:el.alt||''}});
      const largeImgs=imgs.filter(x=>x.height>250&&x.width>300);
      const attrs=(document.body.innerText.match(/Route data © OpenStreetMap/g)||[]).length;
      return {largeImageCount:largeImgs.length, attributionCount:attrs};
    });
    if(headingVisible){await heading.scrollIntoViewIfNeeded(); await page.waitForTimeout(300);}
    await page.screenshot({path:cfg.file,fullPage:false});
    rec(cfg.id,headingVisible&&Object.values(visibleNames).every(Boolean),{headingVisible,visibleNames,oldStaticSignals});
  }catch(e){rec(cfg.id,false,{},String(e));}
  await ctx.close();
}

// Real interaction: Taranaki selector must drive the main map.
for(const [id,width,height] of [['region-taranaki-to-map-desktop',1440,1000],['region-taranaki-to-map-mobile',390,844]]){
  const ctx=await browser.newContext({viewport:{width,height},hasTouch:width<600});
  const page=await ctx.newPage();
  try{
    await page.goto(BASE+'/visual-review/pages/desktop-route-satellite',{timeout:60000}); await ready(page);
    const heading=page.getByText('אזורים במסלול',{exact:true}).first();
    await heading.scrollIntoViewIfNeeded();
    const before=await page.evaluate(()=>scrollY);
    let target=null;
    for(const el of await page.locator('button,a,[role="button"]').all()){
      if(!(await el.isVisible().catch(()=>false))) continue;
      const txt=((await el.innerText().catch(()=>''))||'').trim();
      if(txt.includes('טרנאקי')){target=el;break;}
    }
    if(!target) throw new Error('Taranaki interactive control not found');
    await target.click(); await page.waitForTimeout(1200);
    const after=await page.evaluate(()=>scrollY);
    const body=await page.locator('body').innerText();
    const mapVisible=await page.locator('.atlas-route-layout,.route-map,.leaflet-container').first().isVisible().catch(()=>false);
    const selected=/מציג\s*:?\s*טרנאקי/.test(body)||/selectedRegion[^\n]*taranaki/i.test(await page.locator('html').innerText().catch(()=>''));
    const hasNewPlymouth=/New Plymouth|ניו פלימות/.test(body);
    const hasTaranaki=/Mount Taranaki|הר טרנאקי|טרנאקי/.test(body);
    rec(id,mapVisible&&selected&&hasTaranaki,{beforeScrollY:before,afterScrollY:after,mapVisible,selected,hasNewPlymouth,hasTaranaki,clickedText:((await target.innerText().catch(()=>''))||'').trim()});
  }catch(e){rec(id,false,{},String(e));}
  await ctx.close();
}

await browser.close();
out.summary={total:out.tests.length,passed:out.tests.filter(x=>x.success).length,failed:out.tests.filter(x=>!x.success).length};
await fs.writeFile('regional-check-results.json',JSON.stringify(out,null,2));
console.log(out.summary);
