// Native Chrome DevTools boundary. Start local dev stack and headless Chrome on port 9234.
// Provider POSTs are intercepted in the browser, deliberately IGNORING AbortSignal to prove
// stale-response checks, not just fetch cancellation. All real API requests are read-only.
import assert from 'node:assert/strict';
import console from 'node:console';
import { setTimeout } from 'node:timers';
const pages = await (await globalThis.fetch('http://127.0.0.1:9234/json/list')).json();
const ws = new globalThis.WebSocket(pages.find((page) => page.type === 'page').webSocketDebuggerUrl);
await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));
let next = 0;
const pending = new Map();
ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id) { pending.get(message.id)?.(message); pending.delete(message.id); }
};
const send = (method, params = {}) => new Promise((resolve) => {
  const id = ++next; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const response = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  assert.ok(!response.result?.exceptionDetails, 'Browser expression failed');
  return response.result?.result?.value;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const wait = async (expression) => {
  for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await sleep(100); }
  throw new Error('Browser condition timed out');
};
const click = (selector, text) => evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].find(b=>b.textContent.includes(${JSON.stringify(text)})).click()`);
try {
  await send('Page.enable');
  await send('Page.navigate', { url: 'http://127.0.0.1:5173/' });
  await wait(`document.querySelector('h1')?.textContent.includes('WT-07') && !document.querySelector('.probe:disabled')`);
  await evaluate(`window.pendingAnswers=[]; window.originalFetch=window.fetch;
    window.fetch=(url,init)=> /\\/api\\/(investigate|copilot)$/.test(String(url))
      ? new Promise(resolve=>window.pendingAnswers.push({resolve,request:JSON.parse(init.body)}))
      : window.originalFetch(url,init);
    window.finishAnswer=(index,marker,withEvidence=true)=>{
      const job=window.pendingAnswers[index];
      job.resolve(new Response(JSON.stringify({scope:job.request.scope??'asset',assetCode:job.request.assetCode??null,plan:null,structuredFacts:{},
        answer:{summary:marker,findings:[],uncertainties:[],evidenceStrength:'MODERATE',safetyStatus:'NORMAL'},
        evidence:withEvidence?[{id:'EV-1',kind:'ASSET_EVENT',title:marker,excerpt:marker,assetCode:job.request.assetCode,
          timestamp:null,recordOrigin:'synthetic_demo',authorityClass:'HISTORICAL',sourceType:'ASSET_EVENT',sourceUrl:null,similarity:null}]:[]}),
        {status:200,headers:{'Content-Type':'application/json'}})); };`);
  await click('button', 'Has this happened before?');
  await wait('window.pendingAnswers.length===1');
  await click('.asset-row', 'PEN-T01');
  await wait(`document.querySelector('h1')?.textContent.includes('PEN-T01')`);
  await evaluate(`window.finishAnswer(0,'STALE_WT07')`); await sleep(200);
  assert.equal(await evaluate(`document.body.innerText.includes('STALE_WT07')`), false, 'Stale WT-07 investigation crossed asset boundary');
  console.log('PASS: delayed investigation cannot cross asset boundary');
  await click('nav button', 'AI Copilot');
  await click('.probe', 'Why could this fault');
  await wait('window.pendingAnswers.length===2');
  await click('.asset-row', 'WT-07');
  await evaluate(`window.finishAnswer(1,'STALE_PEN_COPILOT')`); await sleep(200);
  assert.equal(await evaluate(`document.body.innerText.includes('STALE_PEN_COPILOT') || !!document.querySelector('.turn')`), false);
  await click('.probe', 'Why could this fault');
  await wait('window.pendingAnswers.length===3');
  await click('.scope-switch button', 'Fleet');
  await evaluate(`window.finishAnswer(2,'STALE_ASSET_SCOPE')`); await sleep(200);
  assert.equal(await evaluate(`document.body.innerText.includes('STALE_ASSET_SCOPE') || !!document.querySelector('.turn')`), false);
  await click('.probe', 'Which turbines');
  await wait('window.pendingAnswers.length===4');
  await click('.scope-switch button', 'Asset');
  await evaluate(`window.finishAnswer(3,'STALE_FLEET_SCOPE')`); await sleep(200);
  assert.equal(await evaluate(`document.body.innerText.includes('STALE_FLEET_SCOPE') || !!document.querySelector('.turn')`), false);
  // Same-tick double activation must not admit two turns/provider requests.
  await evaluate(`{const b=document.querySelector('.probe');b.click();b.click();}`);
  await wait('window.pendingAnswers.length===5');
  await sleep(200);
  assert.equal(await evaluate('window.pendingAnswers.length'), 5);
  await evaluate(`window.finishAnswer(4,'FRESH_EVIDENCE')`);
  await wait(`document.querySelector('.assessment-summary')?.textContent==='FRESH_EVIDENCE'`);
  await click('.probe', 'What changed');
  await wait('window.pendingAnswers.length===6');
  await evaluate(`window.finishAnswer(5,'EMPTY_ANSWER',false)`);
  await wait(`document.body.innerText.includes('EMPTY_ANSWER')`);
  assert.equal(await evaluate(`document.querySelector('.evidence-col')?.innerText.includes('FRESH_EVIDENCE') ?? false`), false);
  assert.equal(await evaluate(`window.pendingAnswers[4].request.history?.length ?? 0`), 0);
  // A late memory answer must not populate a different workspace's evidence pane either.
  await click('nav button', 'Machine Memory');
  await wait(`!![...document.querySelectorAll('button')].find(b=>b.textContent==='Has this happened before?'&&!b.disabled)`);
  await click('button', 'Has this happened before?');
  await wait('window.pendingAnswers.length===7');
  await click('nav button', 'AI Copilot');
  await evaluate(`window.finishAnswer(6,'STALE_WORKSPACE')`); await sleep(200);
  assert.equal(await evaluate(`document.body.innerText.includes('STALE_WORKSPACE')`), false);
  console.log('PASS: asset/scope/workspace switches, transcript reset, rapid double activation, empty evidence');
  await send('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Karachi' });
  await click('nav button', 'Scenario Lab');
  const time = await evaluate(`({now:Date.now(),submitted:new Date(document.querySelector('input[type=datetime-local]').value).getTime()})`);
  assert.ok(Math.abs(time.now - time.submitted) < 60_000, 'Scenario default shifted from browser now');
  await evaluate(`window.fetch=(url,init)=>{
    if(String(url)==='/api/events') {window.submittedEvent=JSON.parse(init.body);
      return Promise.resolve(new Response(JSON.stringify({error:{code:'VERIFICATION_ONLY',message:'Intercepted; no database write'}}),{status:400}));}
    return window.originalFetch(url,init);
  };
  {const panel=[...document.querySelectorAll('section')].find(s=>s.querySelector('h3')?.textContent==='Add event / fault');
    const select=panel.querySelector('select');
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,'WT-07');
    select.dispatchEvent(new Event('change',{bubbles:true}));
    for(const [placeholder,value] of [['GEAR-TMP-402','TIME-VERIFY'],['Gearbox oil temperature high','Verification only']]){
      const input=panel.querySelector('input[placeholder="'+placeholder+'"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);
      input.dispatchEvent(new Event('input',{bubbles:true}));
    }
  }`);
  await click('button', 'Record event');
  await wait('!!window.submittedEvent');
  const submitted = await evaluate('window.submittedEvent.occurredAt');
  assert.ok(Math.abs(time.now - Date.parse(submitted)) < 60_000, 'Actual default POST shifted');
  await evaluate(`{const input=document.querySelector('input[type=datetime-local]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'2024-02-29T12:00');
    input.dispatchEvent(new Event('input',{bubbles:true})); window.submittedEvent=null;}`);
  await click('button', 'Record event');
  await wait('!!window.submittedEvent');
  assert.equal(await evaluate('window.submittedEvent.occurredAt'), '2024-02-29T07:00:00.000Z');
  console.log('PASS: Asia/Karachi untouched Scenario datetime round-trip');
} finally { ws.close(); }
