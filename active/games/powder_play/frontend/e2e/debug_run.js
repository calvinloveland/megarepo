(async ()=>{
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('console', m=> console.log('PAGE', m.type(), m.text()));
  await page.goto('http://127.0.0.1:5173');
  await page.waitForSelector('text=Powder Playground');
  console.log('Found main title.');
  const hasInstall = await page.$('text=Install model');
  console.log('Has Install button:', !!hasInstall);
  if (hasInstall) {
    await page.click('text=Install model');
    console.log('Clicked Install');
    await page.waitForTimeout(500);
    await page.click('text=Generate');
    console.log('Clicked Generate');
  } else {
    console.log('Install not found');
  }
  // Poll status text
  for (let i=0;i<40;i++){
    const status = await page.textContent('#gen-status');
    console.log('status:',status);
    if (status && status.includes('Validated')) { console.log('Validated reached'); break;}
    await page.waitForTimeout(500);
  }
  const html = await page.content();
  console.log('HTML snapshot length:', html.length);
  await browser.close();
})();
