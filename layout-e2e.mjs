import { chromium } from 'playwright';
import fs from 'node:fs/promises';
const BASE='https://amitai-new-zealand-trip.amitaywagner.chatgpt.site';
const cases=[
 ['390','/visual-review/pages/mobile-now-trip-day-06',390,844],
 ['360','/visual-review/pages/mobile-360-now-trip-day-06',360,800],
 ['430','/visual-review/pages/mobile-now-trip-day-06',430,932],
];
const browser=await chromium.launch({headless:true});
const tests=[];
for(const [name,url,width,height] of cases){
 const ctx=await browser.newContext({viewport:{width,height},hasTouch:true});
 const page=await ctx.newPage();
 try{
  await page.goto(BASE+url,{timeout:60000,waitUntil:'domcontentloaded'});
  await page.waitForLoadState('networkidle',{timeout:10000}).catch(()=>{});
  await page.waitForTimeout(1000);
  const dashboard=page.locator('.live-daily-dashboard').first();
  const box=await dashboard.boundingBox();
  const info=await page.evaluate(()=>{
    const visible=el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0};
    const titles=[...document.querySelectorAll('body *')].filter(el=>visible(el)&&/המסע של תיצ.?ו וצ.?וקי/.test((el.textContent||'').trim())&&el.children.length===0).map(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return{tag:el.tagName,className:String(el.className),top:r.top,height:r.height,width:r.width,fontSize:s.fontSize,text:(el.textContent||'').trim()}});
    const media=[...document.querySelectorAll('img')].filter(visible).map(el=>{const r=el.getBoundingClientRect();return{top:r.top,height:r.height,width:r.width,src:(el.currentSrc||el.src||'').slice(0,120)}});
    const largeBg=[...document.querySelectorAll('body *')].filter(el=>{if(!visible(el))return false;const r=el.getBoundingClientRect(),bg=getComputedStyle(el).backgroundImage;return bg&&bg!=='none'&&r.height>150&&r.top<220}).map(el=>{const r=el.getBoundingClientRect();return{className:String(el.className),top:r.top,height:r.height,width:r.width}});
    return{titles,media,largeBg,bodyText:document.body.innerText.slice(0,1500)};
  });
  const largeMediaBefore=(info.media||[]).some(m=>box&&m.top<box.y&&m.height>150)||(info.largeBg||[]).some(m=>box&&m.top<box.y&&m.height>150);
  const hasDay=/יום\s*6/.test(info.bodyText),hasNext=/הבא|עכשיו/.test(info.bodyText);
  const success=!!box&&box.y<180&&hasDay&&hasNext&&!largeMediaBefore;
  tests.push({id:`mobile-now-${name}-layout-precise`,success,error:null,details:{dashboardBox:box,largeMediaBefore,hasDay,hasNext,titles:info.titles,mediaBefore:(info.media||[]).filter(m=>box&&m.top<box.y),largeBgBefore:(info.largeBg||[]).filter(m=>box&&m.top<box.y)}});
 }catch(e){tests.push({id:`mobile-now-${name}-layout-precise`,success:false,error:String(e),details:{}})}
 await ctx.close();
}
await browser.close();
const out={generatedAt:new Date().toISOString(),environment:'github-actions-playwright-chromium',tests,summary:{total:tests.length,passed:tests.filter(t=>t.success).length,failed:tests.filter(t=>!t.success).length}};
await fs.writeFile('layout-e2e-results.json',JSON.stringify(out,null,2));
console.log(out.summary);
