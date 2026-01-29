const fetch = require('node-fetch');
const models = ['granite4:350m','ministral-3:latest'];
const prompts = {
  tags: (a,b)=>`Provide a short comma-separated list of tags for mixing ${a} and ${b}. Return only tags.`,
  density: (a,b)=>`Provide a single numeric density for mixing ${a} and ${b}. Return only the number.`,
  color: (a,b)=>`Provide a single RGB array like [R,G,B] for mixing ${a} and ${b}. Return only the array.`,
  desc: (a,b)=>`Provide a one-sentence description for mixing ${a} and ${b}. Return only the sentence.`
};

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

async function call(model, prompt, tokens=20, temperature=0.2) {
  const start = Date.now();
  const res = await fetch('http://localhost:11434/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, prompt, stream: false, options: { num_predict: tokens, temperature } })
  }).catch((e)=>({ok:false,error:String(e)}));
  const dur = Date.now()-start;
  if(!res || !res.ok) return { ok:false, dur, status: res && res.status, error: res && res.error };
  const j = await res.json();
  return { ok:true, dur, response: String(j?.response || '') };
}

(async ()=>{
  const a='Salt', b='Water';
  const trials = 5;
  const tokenSets = [12, 20, 40];
  for(const model of models) {
    console.log('\n== MODEL:', model, '==');
    for(const key of Object.keys(prompts)){
      for(const tokens of tokenSets){
        let okCount=0, totalDur=0;
        for(let t=0;t<trials;t++){
          const r = await call(model, prompts[key](a,b), tokens, 0.2);
          const ok = r.ok && (key==='tags'? validateTags(r.response) : key==='density'? validateDensity(r.response) : key==='color'? validateColor(r.response) : Boolean(r.response && r.response.length>10));
          if(ok) okCount++;
          totalDur += (r.dur||0);
        }
        console.log(`${key} tokens=${tokens} -> success ${okCount}/${trials}, avgDur=${Math.round(totalDur/trials)}ms`);
      }
    }
  }
})();
