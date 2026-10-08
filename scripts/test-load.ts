import {Client} from 'pg';
import {spawn,spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {userInfo} from 'node:os';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function main(){
 const base=process.env.TEST_DATABASE_ADMIN_URL||`postgresql://${encodeURIComponent(userInfo().username)}@localhost:5432/postgres`;const name='webinar_test_load_'+randomBytes(6).toString('hex');const admin=new Client({connectionString:base});await admin.connect();await admin.query(`CREATE DATABASE "${name}"`);const target=new URL(base);target.pathname='/'+name;
 const env={...process.env,DATABASE_URL:target.toString(),REGISTRATION_SECRET:'isolated-load-registration-secret-over-32-characters',CREDENTIALS_ENCRYPTION_KEY:'isolated-load-encryption-key-over-32-characters',CADENCE_AUTOTICK:'false',ZOOM_AUTOSYNC:'false',NEXT_DIST_DIR:process.env.NEXT_DIST_DIR||'.next',APP_ORIGIN:'http://127.0.0.1:3102',ANTHROPIC_API_KEY:'',LSQ_ACCESS_KEY:'',LSQ_SECRET_KEY:'',LSQ_HOST:'',NETCORE_API_KEY:'',ZOOM_CLIENT_ID:'',ZOOM_CLIENT_SECRET:'',LINKEDIN_CLIENT_ID:'',LINKEDIN_CLIENT_SECRET:''};
 let server:ReturnType<typeof spawn>|undefined,browser:Awaited<ReturnType<typeof chromium.launch>>|undefined,db:Client|undefined;
 const rows=10_000;const logs:string[]=[];
 try{
  if(spawnSync('npx',['prisma','migrate','deploy'],{env,stdio:'inherit'}).status)throw new Error('Load database migration failed');db=new Client({connectionString:target.toString()});await db.connect();
  await db.query(`INSERT INTO "Campaign" (id,name,vertical,date,status,"scheduledAt","updatedAt") VALUES ('load-event','Large Campaign Verification','Test','Future','draft','2026-12-01',NOW())`);
  await db.query(`INSERT INTO "MessageTemplate" (id,channel,key,name,subject,body,status,"updatedAt") VALUES ('load-template','email','invite','Load Template','Join {{topic}}','Hello {{firstName}}, join {{topic}}: {{link}}','ready',NOW())`);
  await db.query(`INSERT INTO "CadenceStep" (id,"campaignId",key,title,timing,channel,"desc","group",trigger,mode,"templateId") VALUES ('load-step','load-event','invite','Invite','Now','Email','Load invitation','Pre-registration','launch','ai','load-template')`);
  await db.query(`INSERT INTO "Contact" (id,"campaignId",name,email,account,title,"function",seniority,vertical,score,approved,"registeredAt","registrationSource",attended,"enrichedAt",source) SELECT 'load-'||lpad(n::text,5,'0'),'load-event','Load Contact '||lpad(n::text,5,'0'),'load'||n||'@testing.example','Account '||(n%2000),'Director','Marketing','Director','Test',82,true,CASE WHEN n%2=0 THEN NOW() END,CASE n%8 WHEN 0 THEN 'email_campaign' WHEN 1 THEN 'whatsapp' WHEN 2 THEN 'linkedin' WHEN 3 THEN 'sdr_sales' WHEN 4 THEN 'third_parties' WHEN 5 THEN 'linkedin_event' WHEN 6 THEN 'sms' ELSE 'website' END,n%4=0,CASE WHEN n%3=0 THEN NOW() END,'CSV' FROM generate_series(1,$1) n`,[rows]);
  await db.query(`INSERT INTO "PersonalizedMessage" (id,"campaignId","contactId","stepKey",channel,subject,body) SELECT 'message-'||id,'load-event',id,'invite','email','Join the webinar','Hello '||name||', register: https://registration.testing.example' FROM "Contact"`);
  await db.query(`UPDATE "Campaign" SET "registrationLink"='https://registration.testing.example' WHERE id='load-event'`);
  await db.query(`INSERT INTO "CadenceSend" (id,"campaignId","contactId","stepKey","dueAt",status,"sentAt") SELECT 'send-'||id,'load-event',id,'invite',NOW(),'sent',NOW() FROM "Contact"`);
  await db.query('ANALYZE');
  server=spawn('node',['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3102'],{env,stdio:['ignore','pipe','pipe']});server.stdout?.on('data',v=>logs.push(String(v)));server.stderr?.on('data',v=>logs.push(String(v)));
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:3102')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,200));}if(!ready)throw new Error('Load test server did not become ready');
  browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000}});await context.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());const page=await context.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const measurements:Array<{path:string;loadedMs:number;htmlBytes:number}> = [];
  for(const route of ['overview','audience','messaging','cadence']){
   const path=`/campaigns/load-event/${route}`;const start=performance.now();const response=await page.goto('http://127.0.0.1:3102'+path);expect(response?.status()).toBe(200);await page.locator('main').first().waitFor();await expect(page.locator('main[aria-busy="true"], .lsq-skeleton')).toHaveCount(0);await page.waitForLoadState('networkidle');const loadedMs=Math.round(performance.now()-start);const htmlBytes=(await response!.body()).byteLength;expect(loadedMs,`${route} must load within 15 seconds`).toBeLessThan(15000);expect(htmlBytes,`${route} HTML/RSC must remain under 1 MB with 10,000 contacts`).toBeLessThan(1_000_000);measurements.push({path,loadedMs,htmlBytes});
   if(route==='messaging'||route==='cadence'){await expect(page.getByText('1–50 of 10,000',{exact:false})).toBeVisible();await page.getByRole('link',{name:'Next page',exact:true}).click();await expect(page.getByText('51–100 of 10,000',{exact:false})).toBeVisible();await expect(page.locator('main[aria-busy="true"], .lsq-skeleton')).toHaveCount(0);}
  }
  await page.goto('http://127.0.0.1:3102/campaigns/load-event/messaging?page=200');await expect(page.getByText('9,951–10,000 of 10,000',{exact:false})).toBeVisible();await expect(page.getByRole('button',{name:/Load Contact 10000/})).toBeVisible();
  await page.goto('http://127.0.0.1:3102/campaigns/load-event/messaging?q=load10000%40testing.example');await expect(page.getByText('1–1 of 1',{exact:false})).toBeVisible();await expect(page.getByRole('button',{name:/Load Contact 10000/})).toBeVisible();
  await page.goto('http://127.0.0.1:3102/campaigns/load-event/cadence?q=load10000%40testing.example');await expect(page.getByText('1–1 of 1',{exact:false})).toBeVisible();
  await page.setViewportSize({width:390,height:1000});
  await mkdir('artifacts/verification/browser',{recursive:true});
  for(const route of ['messaging','cadence']){
   await page.goto(`http://127.0.0.1:3102/campaigns/load-event/${route}`);await expect(page.locator('main[aria-busy="true"], .lsq-skeleton')).toHaveCount(0);await page.waitForLoadState('networkidle');
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),`Mobile ${route} overflow`).toBe(true);
   const accessibility=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();expect(accessibility.violations.filter(v=>v.impact==='serious'||v.impact==='critical'),`Mobile ${route} accessibility`).toEqual([]);
   await page.screenshot({path:`artifacts/verification/browser/390-load-${route}.png`});
  }
  const concurrent=[];for(let batch=0;batch<3;batch++){const start=performance.now();const sizes=await Promise.all(Array.from({length:8},async(_,i)=>{const response=await fetch(`http://127.0.0.1:3102/campaigns/load-event/${i%2?'messaging':'overview'}?page=${i+1}`);expect(response.status).toBe(200);return (await response.arrayBuffer()).byteLength;}));concurrent.push({requests:8,totalMs:Math.round(performance.now()-start),maxHtmlBytes:Math.max(...sizes)});expect(concurrent.at(-1)!.totalMs).toBeLessThan(20000);expect(Math.max(...sizes)).toBeLessThan(1_000_000);}
  expect(errors).toEqual([]);const report={verifiedAt:new Date().toISOString(),contacts:rows,personalizedMessages:rows,sends:rows,externalProviderCalls:0,measurements,concurrent,checks:['50-recipient server pages','next-page navigation','last-page access','email search','bounded HTML/RSC payload','24 concurrent page requests in groups of eight','mobile pagination: no document overflow or serious/critical accessibility violations','zero browser errors']};await mkdir('artifacts/verification',{recursive:true});await writeFile('artifacts/verification/load-results.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
 }finally{await db?.end();await browser?.close();if(server&&server.exitCode===null){server.kill('SIGTERM');await new Promise<void>(r=>server!.once('exit',()=>r()));}await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);await admin.end();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
