const fetch = require('node-fetch');

const base = process.env.MIX_API_BASE || 'http://127.0.0.1:8787';

async function call(prompt, tokens=20, temperature=0.2) {
  const start = Date.now();
  const res = await fetch(`${base}/llm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, format: 'text', options: { num_predict: tokens, temperature } }),
  });
  const dur = Date.now() - start;
  if (!res.ok) {
    const txt = await res.text();
    return { ok: false, dur, status: res.status, body: txt };
  }
  const j = await res.json();
  return { ok: true, dur, body: j.response };
}

async function runTrials(trials=5) {
  const a='Salt', b='Water';
  const tagsPrompt = `Provide short comma-separated tags for mixing ${a} and ${b}. Return only tags.`;
  const densityPrompt = `Provide a single numeric density for mixing ${a} and ${b}. Return only the number.`;
  const colorPrompt = `Provide an RGB array like [R,G,B] for mixing ${a} and ${b}. Return only the array.`;
  const descPrompt = `Provide a one-sentence description for mixing ${a} and ${b}. Return only the sentence.`;

  const seqTotals = [];
  const parTotals = [];

  for (let t=0;t<trials;t++) {
    const seqStart = Date.now();
    await call(tagsPrompt, 20, 0.2);
    await call(densityPrompt, 8, 0.2);
    await call(colorPrompt, 12, 0.2);
    await call(descPrompt, 12, 0.2);
    seqTotals.push(Date.now()-seqStart);

    const parStart = Date.now();
    const ps = [call(tagsPrompt,20,0.2), call(densityPrompt,8,0.2), call(colorPrompt,12,0.2), call(descPrompt,12,0.2)];
    const results = await Promise.all(ps);
    // parallel measured by max duration among results (approx overall elapsed)
    const maxDur = Math.max(...results.map(r=>r.dur));
    parTotals.push(maxDur);

    console.log(`trial ${t+1}: seq=${seqTotals[t]}ms par_max=${parTotals[t]}ms`);
  }

  const avgSeq = seqTotals.reduce((a,b)=>a+b,0)/seqTotals.length;
  const avgPar = parTotals.reduce((a,b)=>a+b,0)/parTotals.length;
  console.log(`avg sequential total: ${avgSeq}ms`);
  console.log(`avg parallel max: ${avgPar}ms`);
}

runTrials(6).catch(e=>{console.error(e); process.exit(1);});
