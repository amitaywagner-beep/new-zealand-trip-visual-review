import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const BASE='https://amitai-new-zealand-trip.amitaywagner.chatgpt.site';
const manifest=await (await fetch(BASE+'/visual-review/manifest.json',{cache:'no-store'})).json();
const docStates=(manifest.screenshots||[]).filter(x=>/document|booking-with-documents|day-with-documents/i.test(x.id||''));
const browser=await chromium.launch({headless:true});
const outDir=path.resolve('document-vault-audit'); await fs.mkdir(outDir,{recursive:true});
const pages=[];

for(const item of docStates){
  const m=String(item.viewport||'1440x1000').match(/(\d+)x(\d+)/); const width=m?+m[1]:1440, height=m?+m[2]:1000;
  const ctx=await browser.newContext({viewport:{width,height},hasTouch:Boolean(item.emulateTouch)}); const p=await ctx.newPage();
  const consoleErrors=[]; const pageErrors=[]; const failedRequests=[];
  p.on('console',msg=>{if(msg.type()==='error') consoleErrors.push(msg.text())});
  p.on('pageerror',e=>pageErrors.push(String(e)));
  p.on('requestfailed',r=>failedRequests.push({url:r.url(),error:r.failure()?.errorText||'failed'}));
  let error=null;
  try{
    await p.goto(new URL(item.url,BASE).href,{waitUntil:'domcontentloaded',timeout:60000});
    await p.waitForLoadState('networkidle',{timeout:10000}).catch(()=>{}); await p.waitForTimeout(1200);
    await p.screenshot({path:path.join(outDir,`${item.id}.png`),fullPage:Boolean(item.fullPage)});
    const info=await p.evaluate(()=>{
      const visible=el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0};
      const controls=[...document.querySelectorAll('button,a,[role="button"],input[type="file"]')].filter(visible).map(el=>({tag:el.tagName,type:el.getAttribute('type'),text:(el.innerText||el.getAttribute('aria-label')||el.getAttribute('placeholder')||'').trim(),href:el.getAttribute('href'),accept:el.getAttribute('accept')}));
      const fileInputs=[...document.querySelectorAll('input[type="file"]')].map(el=>({accept:el.accept,multiple:el.multiple,disabled:el.disabled}));
      const body=(document.body.innerText||'');
      const hrefs=[...document.querySelectorAll('a[href]')].map(a=>a.href).filter(h=>/document|storage|blob|signed|download|pdf|jpg|png/i.test(h));
      return {title:document.title,body:body.slice(0,6000),controls:controls.slice(0,120),fileInputs,docLikeHrefs:hrefs.slice(0,50),width:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth};
    });
    pages.push({id:item.id,viewport:item.viewport,success:true,info,consoleErrors:consoleErrors.slice(0,10),pageErrors:pageErrors.slice(0,10),failedRequests:failedRequests.slice(0,15)});
  }catch(e){error=String(e);pages.push({id:item.id,viewport:item.viewport,success:false,error,consoleErrors,pageErrors,failedRequests});}
  await ctx.close();
}

async function fetchText(url){try{const r=await fetch(url,{cache:'no-store'});return {status:r.status,text:(await r.text()).slice(0,200000)}}catch(e){return {status:null,error:String(e),text:''}}}
const tripData=await fetchText(BASE+'/trip-data.json');
const tripReview=await fetchText(BASE+'/trip-review.txt');
const exposurePatterns=['passport','דרכון','תעודת זהות','personalDocument','Sample Hobbiton Ticket','Sample Hotel Voucher'];
const exportExposure={}; for(const pat of exposurePatterns){exportExposure[pat]={tripData:tripData.text.toLowerCase().includes(pat.toLowerCase()),tripReview:tripReview.text.toLowerCase().includes(pat.toLowerCase())};}

await browser.close();
const result={generatedAt:new Date().toISOString(),siteVersion:manifest.siteVersion,totalDocumentReviewStates:docStates.length,documentReviewStateIds:docStates.map(x=>x.id),pages,exports:{tripDataStatus:tripData.status,tripReviewStatus:tripReview.status,exposure:exportExposure}};
await fs.writeFile('document-vault-audit.json',JSON.stringify(result,null,2));
console.log(JSON.stringify({siteVersion:result.siteVersion,states:result.documentReviewStateIds,pages:pages.map(x=>({id:x.id,success:x.success,fileInputs:x.info?.fileInputs?.length||0,overflow:(x.info?.width||0)>(x.info?.clientWidth||0)})),exportExposure},null,2));

// Manual audit refresh for site version 38: 2026-08-24T17:38+03:00
