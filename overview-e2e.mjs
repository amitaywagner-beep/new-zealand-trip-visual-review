import { chromium } from 'playwright';
import fs from 'node:fs/promises';
const BASE='https://amitai-new-zealand-trip.amitaywagner.chatgpt.site';
const tests=[]; const browser=await chromium.launch({headless:true});
async function test(id,fn){try{const d=await fn();tests.push({id,success:true,details:d});}catch(e){tests.push({id,success:false,error:String(e)});}}

await test('mobile-overview-structure',async()=>{
 const ctx=await browser.newContext({viewport:{width:390,height:844},hasTouch:true}); const p=await ctx.newPage();
 await p.goto(BASE+'/visual-review/pages/mobile-trip-overview',{waitUntil:'domcontentloaded',timeout:60000}); await p.waitForTimeout(1200);
 const o=p.locator('.route-overview-graphic').first(); const box=await o.boundingBox(); if(!box) throw new Error('overview missing');
 const info=await o.evaluate(el=>({
   height:el.getBoundingClientRect().height,width:el.getBoundingClientRect().width,
   buttons:[...el.querySelectorAll('button,a,[role="button"]')].map(x=>{const r=x.getBoundingClientRect(),s=getComputedStyle(x);return{text:(x.innerText||x.textContent||'').trim(),width:r.width,height:r.height,fontSize:s.fontSize,overflowX:x.scrollWidth>x.clientWidth,overflowY:x.scrollHeight>x.clientHeight}}).filter(x=>x.text),
   maps:el.querySelectorAll('.leaflet-container,[class*="map"],canvas').length,
   images:el.querySelectorAll('img').length,
   attributions:[...el.querySelectorAll('*')].filter(x=>/Esri|Maxar|OpenStreetMap/.test(x.textContent||'')).length,
   scrollWidth:el.scrollWidth,clientWidth:el.clientWidth,scrollHeight:el.scrollHeight,clientHeight:el.clientHeight,
   text:(el.innerText||'').slice(0,1800)
 }));
 if(info.maps>0||info.images>0||info.attributions>0) throw new Error('overview still contains map-like media/attribution');
 if(!/01/.test(info.text)||!/10/.test(info.text)) throw new Error('not all stops present');
 await ctx.close(); return info;
});

await test('mobile-overview-stop-06-clicks-map',async()=>{
 const ctx=await browser.newContext({viewport:{width:390,height:844},hasTouch:true}); const p=await ctx.newPage();
 await p.goto(BASE+'/visual-review/pages/mobile-trip-overview',{waitUntil:'domcontentloaded',timeout:60000}); await p.waitForTimeout(1200);
 const o=p.locator('.route-overview-graphic').first();
 const candidates=o.locator('button,a,[role="button"]'); const n=await candidates.count(); let target=null;
 for(let i=0;i<n;i++){const el=candidates.nth(i); const t=((await el.innerText().catch(()=>''))||'').trim(); if(/06|ניו פלימות|New Plymouth/i.test(t)){target=el;break;}}
 if(!target) throw new Error('stop 06 control not found'); const before=await p.evaluate(()=>scrollY); await target.click(); await p.waitForTimeout(1000);
 const after=await p.evaluate(()=>scrollY); const map=p.locator('.leaflet-container').first(); const mapVisible=await map.isVisible().catch(()=>false); const body=await p.locator('body').innerText();
 if(!mapVisible||!/ניו פלימות|New Plymouth/i.test(body)) throw new Error('map did not focus stop 06');
 await ctx.close(); return {before,after,mapVisible,hasNewPlymouth:/ניו פלימות|New Plymouth/i.test(body)};
});

await test('desktop-overview-palmerston-clicks-map',async()=>{
 const ctx=await browser.newContext({viewport:{width:1440,height:1000}}); const p=await ctx.newPage();
 await p.goto(BASE+'/visual-review/pages/trip-at-a-glance',{waitUntil:'domcontentloaded',timeout:60000}); await p.waitForTimeout(1200);
 const o=p.locator('.route-overview-graphic').first(); const candidates=o.locator('button,a,[role="button"]'); const n=await candidates.count(); let target=null;
 for(let i=0;i<n;i++){const el=candidates.nth(i); const t=((await el.innerText().catch(()=>''))||'').trim(); if(/09|פלמרסטון|Palmerston/i.test(t)){target=el;break;}}
 if(!target) throw new Error('Palmerston control not found'); await target.click(); await p.waitForTimeout(900); const body=await p.locator('body').innerText();
 const mapVisible=await p.locator('.leaflet-container').first().isVisible().catch(()=>false); if(!mapVisible||!/Palmerston North|פלמרסטון/.test(body)) throw new Error('Palmerston did not focus map');
 await ctx.close(); return {mapVisible,hasFamily:/משפחה וחתונה/.test(body)};
});

await browser.close(); const out={generatedAt:new Date().toISOString(),tests,summary:{total:tests.length,passed:tests.filter(x=>x.success).length,failed:tests.filter(x=>!x.success).length}}; await fs.writeFile('overview-e2e-results.json',JSON.stringify(out,null,2)); console.log(out.summary);
