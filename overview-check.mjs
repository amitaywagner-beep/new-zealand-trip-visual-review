import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
const BASE='https://amitai-new-zealand-trip.amitaywagner.chatgpt.site';
const manifest=await (await fetch(BASE+'/visual-review/manifest.json',{cache:'no-store'})).json();
const wanted=(manifest.screenshots||[]).filter(x=>/trip-at-a-glance|overview|regional-selector|region-.*-map/i.test(x.id));
await fs.mkdir('overview-check',{recursive:true});
const browser=await chromium.launch({headless:true});
const results=[];
for(const item of wanted){
 const m=String(item.viewport||'1440x1000').match(/(\d+)x(\d+)/); const width=m?+m[1]:1440,height=m?+m[2]:1000;
 const ctx=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,hasTouch:!!item.emulateTouch});
 const page=await ctx.newPage(); let success=true,error=null;
 try{
  await page.goto(new URL(item.url,BASE).href,{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForLoadState('networkidle',{timeout:10000}).catch(()=>{}); await page.waitForTimeout(1000);
  const target=item.captureTarget?page.locator(item.captureTarget).first():null;
  const out=path.join('overview-check',item.id+'.png');
  if(target){await target.waitFor({state:'visible',timeout:15000}); await target.screenshot({path:out});} else await page.screenshot({path:out,fullPage:!!item.fullPage});
  const body=await page.locator('body').innerText();
  results.push({id:item.id,viewport:item.viewport,success:true,state:item.state,hasSatelliteAttribution:/Esri|Maxar|OpenStreetMap/i.test(body),bodySample:body.slice(0,1800)});
 }catch(e){success=false;error=String(e);results.push({id:item.id,viewport:item.viewport,success,error,state:item.state});}
 await ctx.close();
}
await browser.close();
const out={generatedAt:new Date().toISOString(),siteVersion:manifest.siteVersion,total:results.length,results};
await fs.writeFile('overview-check-results.json',JSON.stringify(out,null,2));
console.log(JSON.stringify({siteVersion:manifest.siteVersion,total:results.length,ids:results.map(x=>x.id)}));
