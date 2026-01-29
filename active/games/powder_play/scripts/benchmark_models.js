const fetch = require('node-fetch');
const models = ['lfm2.5-thinking','granite4:350m','granite4','ministral-3','nemotron-3-nano','llama3.2'];
const prompts = {
  tags: (a,b)=>`Provide a short comma-separated list of tags for mixing ${a} and ${b}. Return only tags.`,
  density: (a,b)=>`Provide a single numeric density for mixing ${a} and ${b}. Return only the number.`,
  color: (a,b)=>`Provide a single RGB array like [R,G,B] for mixing ${a} and ${b}. Return only the array.`,
  desc: (a,b)=>`Provide a one-sentence description for mixing ${a} and ${b}. Return only the sentence.`,
  single: (a,b)=>`Create a material that represents mixing ${a} and ${b}. Return ONLY JSON with fields: type, name, description, tags, density, color.`
};

function parseJsonFromText(text) {
  if (!text) return null;
  try { return JSON.parse(text); } catch (e) {}
  const start = text.indexOf('{'); if (start === -1) return null;
  const end = text.lastIndexOf('}'); if (end === -1) return null;
  try { return JSON.parse(text.slice(start, end+1)); } catch(e) { return null; }
}

async function call(model, prompt, tokens=20, temperature=0.2) {
  const start = Date.now();
  const res = await fetch('http://localhost:11434/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, stream: false, options: { num_predict: tokens, temperature } })
  });
  const dur = Date.now()-start;
  if (!res.ok) return { ok:false, status: res.status, dur };
  const j = await res.json();
  return { ok:true, dur, response: String(j?.response || '') };
}

function validateTags(text){
  if(!text) return false;
  const parts = text.split(/[\s,]+/).map(s=>s.trim()).filter(Boolean);
  return parts.length>0;
}

function validateDensity(text){
  if(!text) return false;
  return !isNaN(Number((text.match(/[-0-9.]+/)||[])[0]));
}

function validateColor(text){
  if(!text) return false;
  try{ const p=JSON.parse(text); if(Array.isArray(p) && p.length>=3) return true; }catch(e){}
  const nums = text.match(/\d+/g); if(nums && nums.length>=3) return true; return false;
}

(async ()=>{
  const a='Salt', b='Water';
  const trials = 5;
  const results = {};
  for(const model of models) {
    console.log('\n== MODEL:', model, '==');
    results[model]={perProperty:{},single:{}};
    // per-property trials
    for(const key of ['tags','density','color','desc']){
      results[model].perProperty[key]=[];
      for(let t=0;t<trials;t++){
        const r = await call(model, prompts[key](a,b), 20, 0.2);
        const ok = r.ok && ( key==='tags'? validateTags(r.response) : key==='density'? validateDensity(r.response) : key==='color'? validateColor(r.response) : Boolean(r.response && r.response.length>10));
        results[model].perProperty[key].push({dur: r.dur, ok, text: (r.response||'').slice(0,200)});
        console.log(key, t+1, 'dur', r.dur, 'ok', ok);
      }
    }
    // single-shot trials with tokens 20 and 80
    for(const tokens of [20,80]){
      const arr=[];
      for(let t=0;t<trials;t++){
        const r = await call(model, prompts.single(a,b), tokens, 0.2);
        const parsed = r.ok ? parseJsonFromText(r.response) : null;
        const ok = parsed && parsed.type && parsed.name && Array.isArray(parsed.tags) && parsed.tags.length>0 && typeof parsed.density==='number';
        arr.push({dur:r.dur, ok, sample: (r.response||'').slice(0,400)});
        console.log('single', 'tokens', tokens, t+1, 'dur', r.dur, 'ok', ok);
      }
      results[model].single[tokens]=arr;
    }
  }
  console.log('\nSummary:');
  console.log(JSON.stringify(results,null,2));
})();
