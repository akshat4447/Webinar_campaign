import {Client} from 'pg';
import {spawn,spawnSync} from 'node:child_process';
import {randomBytes,createHmac} from 'node:crypto';
import {userInfo} from 'node:os';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function main(){
 const base=process.env.TEST_DATABASE_ADMIN_URL||`postgresql://${encodeURIComponent(userInfo().username)}@localhost:5432/postgres`;
 const admin=new Client({connectionString:base});await admin.connect();
 const name=`webinar_test_ui_${randomBytes(5).toString('hex')}`;await admin.query(`CREATE DATABASE "${name}"`);
 const target=new URL(base);target.pathname='/'+name;
 const secret='isolated-browser-registration-secret-with-32-characters';
 const env={...process.env,DATABASE_URL:target.toString(),REGISTRATION_SECRET:secret,CREDENTIALS_ENCRYPTION_KEY:'isolated-browser-encryption-key-with-32-characters',CADENCE_AUTOTICK:'false',ZOOM_AUTOSYNC:'false',NEXT_DIST_DIR:process.env.NEXT_DIST_DIR||'.next',APP_ORIGIN:'http://127.0.0.1:3100',ANTHROPIC_API_KEY:'',LSQ_ACCESS_KEY:'',LSQ_SECRET_KEY:'',LSQ_HOST:'',NETCORE_API_KEY:'',ZOOM_CLIENT_ID:'',ZOOM_CLIENT_SECRET:'',LINKEDIN_CLIENT_ID:'',LINKEDIN_CLIENT_SECRET:''};
 let db:Client|undefined;
 let server:ReturnType<typeof spawn>|undefined,browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
 const out='artifacts/verification/browser';await mkdir(out,{recursive:true});
 try{
  if(spawnSync('npx',['prisma','migrate','deploy'],{env,stdio:'inherit'}).status)throw new Error('Browser database migration failed');
  db=new Client({connectionString:target.toString()});await db.connect();
  await db.query(`INSERT INTO "Campaign" ("id","name","vertical","date","status","scheduledAt","durationMinutes","updatedAt") VALUES ('ui-event','Browser Test Webinar','Test','Future','draft','2026-12-01 12:00:00',90,NOW()),('ui-closed','Closed Webinar','Test','Past','completed',NULL,60,NOW())`);
  await db.query(`INSERT INTO "MessageTemplate" ("id","channel","key","name","subject","body","status","updatedAt") VALUES ('ui-template','email','invite','Browser Template','Join {{topic}}','Hello {{firstName}}, join {{topic}}: {{link}}','ready',NOW())`);
  await db.query(`INSERT INTO "Contact" ("id","campaignId","name","email","account","title","function","seniority","vertical","registeredAt","zoomJoinUrl") VALUES ('ui-attendee','ui-event','Browser Attendee','existing@example.com','Example','Director','Marketing','Director','Test',NOW(),'https://zoom.example/personal-browser')`);
  await db.query(`UPDATE "Contact" SET "approved"=true,"score"=82,"explanation"='Relevant test audience' WHERE "id"='ui-attendee'`);
  await db.query(`INSERT INTO "CadenceStep" ("id","campaignId","key","title","timing","channel","desc","group","trigger","mode","templateId") VALUES ('ui-step','ui-event','invite','Invite','Now','Email','Test invitation','Pre-registration','launch','template','ui-template')`);
  const logs:string[]=[];server=spawn('node',['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3100'],{env,stdio:['ignore','pipe','pipe']});server.stdout?.on('data',d=>logs.push(String(d)));server.stderr?.on('data',d=>logs.push(String(d)));
  let ready=false;for(let i=0;i<100;i++){try{const r=await fetch('http://127.0.0.1:3100');if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,300));}if(!ready)throw new Error('Browser test server did not start: '+logs.join(''));
  browser=await chromium.launch({channel:'chrome',headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1000}});const page=await context.newPage();
  const errors:string[]=[],checks:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/*',route=>{const host=new URL(route.request().url()).hostname;return ['127.0.0.1','localhost'].includes(host)?route.continue():route.abort();});
  const paths=['/','/dashboard','/templates','/integrations','/campaigns/new','/campaigns/ui-event/overview','/campaigns/ui-event/audience','/campaigns/ui-event/messaging','/campaigns/ui-event/cadence','/campaigns/ui-event/results','/register/ui-event'];
  const violations:unknown[]=[];
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});
   for(const path of paths){
    const response=await page.goto('http://127.0.0.1:3100'+path);expect(response?.status(),path).toBe(200);await page.locator('main').first().waitFor();
    await expect(page.locator('main[aria-busy="true"], .lsq-skeleton')).toHaveCount(0);
    await page.waitForLoadState('networkidle');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),`${width}px overflow: ${path}`).toBe(true);
    const result=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();const serious=result.violations.filter(v=>v.impact==='serious'||v.impact==='critical');
    violations.push(...serious.map(v=>({path,width,id:v.id,description:v.description,nodes:v.nodes.map(n=>n.target)})));
    await page.screenshot({path:`${out}/${width}-${path.replaceAll('/','_')||'home'}.png`,fullPage:true});checks.push(`${width}px ${path}: HTTP 200; no document overflow`);
   }
  }
  await page.setViewportSize({width:1440,height:1000});await page.goto('http://127.0.0.1:3100/templates?id=ui-template');
  const trigger=page.getByRole('button',{name:'Copy To Campaigns'});await trigger.focus();await trigger.click();const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
  for(let i=0;i<20;i++){await page.keyboard.press(i%2?'Shift+Tab':'Tab');expect(await dialog.evaluate(el=>el.contains(document.activeElement))).toBe(true);}
  expect(await trigger.evaluate(el=>!!el.closest('[inert]'))).toBe(true);await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();await expect(trigger).toBeFocused();checks.push('Modal keyboard focus, inert background, Escape, and focus restoration pass');
  await page.goto('http://127.0.0.1:3100/register/ui-event');await page.getByRole('button',{name:'Register',exact:true}).click();await expect(page.getByText('Enter a first name.')).toBeVisible();await expect(page.getByLabel('First name', {exact:false})).toBeFocused();
  await page.getByLabel('First name',{exact:false}).fill('Browser');await page.getByLabel('Work email',{exact:false}).fill('browser-new@example.com');await page.getByRole('button',{name:'Register',exact:true}).click();await page.waitForURL('**/r/result?status=registered');await expect(page.getByRole('heading',{name:'Registration Confirmed'})).toBeVisible();
  const count=await db.query(`SELECT count(*) FROM "Contact" WHERE "campaignId"='ui-event' AND "email"='browser-new@example.com' AND "registeredAt" IS NOT NULL AND "approved"=false`);expect(Number(count.rows[0].count)).toBe(1);checks.push('Registration validation and real database persistence pass');
  const duplicate=await page.request.post('http://127.0.0.1:3100/api/landing/submit',{data:{campaignId:'ui-event',email:'existing@example.com'}});const json=await duplicate.json();expect(json.token).toBeUndefined();expect(json.joinUrl).toBeUndefined();checks.push('Email-only duplicate response contains no private attendee access');
  await page.goto('http://127.0.0.1:3100/register/ui-closed');await expect(page.getByText('This Webinar Has Ended')).toBeVisible();expect(await page.getByRole('button',{name:'Register',exact:true}).count()).toBe(0);checks.push('Closed registration has no signup form');
  const head=['v2','ui-event','ui-attendee',Math.floor(Date.now()/1000).toString(36)].join('.');const token=head+'.'+createHmac('sha256',secret).update(head).digest().subarray(0,16).toString('base64url');
  await page.goto('http://127.0.0.1:3100/r/result?status=registered&t='+token);await expect(page.locator('a[href="https://zoom.example/personal-browser"]')).toBeVisible();
  const calendar=await page.request.get('http://127.0.0.1:3100/api/calendar/ui-event?t='+token);const ics=await calendar.text();expect(ics).toContain('DTEND:20261201T133000Z');expect(ics).toContain('https://zoom.example/personal-browser');checks.push('Signed attendee hub and 90-minute personal calendar pass');
  await writeFile(out+'/results.json',JSON.stringify({checks,errors,violations},null,2));await writeFile(out+'/server.log',logs.join(''));await db.end();db=undefined;
  expect(errors,'Browser runtime errors').toEqual([]);expect(violations,'Serious or critical accessibility violations').toEqual([]);console.log(`Browser verification passed: ${checks.length} checks; desktop/mobile, registration, attendee calendar, modal focus, accessibility.`);
 }finally{await db?.end();await browser?.close();if(server && server.exitCode===null){server.kill('SIGTERM');await new Promise<void>(r=>server!.once('exit',()=>r()));}await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);await admin.end();}
}
main().catch(err=>{console.error(err);process.exitCode=1;});
