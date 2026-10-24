const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const b=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 try{
  const p=await b.newPage();await p.goto('http://127.0.0.1:8765');
  await p.locator('#sample').click();await p.waitForFunction(()=>document.querySelector('#status').textContent.includes('분석 완료'));
  // Delay only the network response; do not delete the shared test sample.
  let release,entered;
  const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve);
  await p.route('**/api/jobs/*',async route=>{
   if(route.request().method()!=='DELETE')return route.continue();
   entered();await gate;await route.fulfill({status:200,contentType:'application/json',body:'{"deleted":true}'});
  });
  await p.locator('#remove').click();await started;
  try{
   assert.equal(await p.locator('#file').isDisabled(),true,'file selection locked while deleting');
   assert.equal(await p.locator('#sample').isDisabled(),true,'sample locked while deleting');
   assert.equal(await p.locator('#remove').isDisabled(),true,'duplicate delete locked');
  }finally{release()}
  await p.waitForFunction(()=>document.querySelector('#status').textContent.includes('삭제했습니다'));
  assert.equal(await p.locator('#analyze').isDisabled(),false);
  console.log('PASS: deletion locks conflicting actions and unlocks afterwards');
 }finally{await b.close()}
})().catch(e=>{console.error(e);process.exit(1)});
