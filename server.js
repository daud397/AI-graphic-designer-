// MUHSQ AI Creative Agent — server.js
// The client's OpenAI API key is entered at login and held ONLY in server memory for that
// session (never written to disk, the database, or logs). It is discarded on logout / restart.
const express=require('express'); const path=require('path'); const fs=require('fs'); const crypto=require('crypto');
const helmet=require('helmet'); const rateLimit=require('express-rate-limit');
const { db }=require('./db');

const app=express(); app.set('trust proxy',1);
app.use(helmet({contentSecurityPolicy:false,crossOriginEmbedderPolicy:false}));
app.use(express.json({limit:'2mb'}));
const BLOCK=/(^|\/)(server\.js|db\.js|package(-lock)?\.json|Procfile|README|node_modules|data)(\/|$)|\.(db|db-wal|db-shm|env)$/i;
app.use((req,res,next)=>{ if(BLOCK.test(req.path)) return res.status(404).end(); next(); });
app.use(rateLimit({windowMs:60000,max:300,standardHeaders:true,legacyHeaders:false}));
const loginLimiter=rateLimit({windowMs:600000,max:20,message:{error:'Too many attempts. Wait a few minutes.'}});

const IMAGES_DIR=process.env.IMAGES_DIR||path.join(__dirname,'data','images');
fs.mkdirSync(IMAGES_DIR,{recursive:true});
app.use('/media',express.static(IMAGES_DIR,{maxAge:'7d'}));

// ---- session-only auth: token -> { role, apiKey, exp } — apiKey lives ONLY here, in RAM ----
const sessions=new Map();
function newSession(role,apiKey){ const t=crypto.randomBytes(24).toString('hex'); sessions.set(t,{role,apiKey,exp:Date.now()+8*3600*1000}); return t; }
function auth(req,res,next){ const t=req.get('x-auth-token')||''; const s=sessions.get(t);
  if(!s) return res.status(401).json({error:'Please sign in again.'});
  if(Date.now()>s.exp){ sessions.delete(t); return res.status(401).json({error:'Session expired — please sign in again.'}); }
  req.session=s; next(); }
setInterval(()=>{ const n=Date.now(); for(const[k,v] of sessions) if(n>v.exp) sessions.delete(k); }, 3600000).unref();

// ---- OpenAI calls (server-side only; key never touches the browser after login) ----
async function openaiImage(apiKey, prompt){
  const r=await fetch('https://api.openai.com/v1/images/generations',{
    method:'POST', headers:{'Authorization':'Bearer '+apiKey,'Content-Type':'application/json'},
    body:JSON.stringify({ model:'gpt-image-1', prompt, size:'1024x1024', quality:'medium', n:1 })
  });
  const j=await r.json();
  if(!r.ok) throw new Error(j.error?.message||'Image generation failed');
  return j.data[0].b64_json;
}
async function openaiCaption(apiKey, systemPrompt, userPrompt){
  const r=await fetch('https://api.openai.com/v1/chat/completions',{
    method:'POST', headers:{'Authorization':'Bearer '+apiKey,'Content-Type':'application/json'},
    body:JSON.stringify({ model:'gpt-4o-mini', messages:[{role:'system',content:systemPrompt},{role:'user',content:userPrompt}], temperature:0.9 })
  });
  const j=await r.json();
  if(!r.ok) throw new Error(j.error?.message||'Caption generation failed');
  return j.choices[0].message.content.trim();
}
function saveImage(b64){ const name=crypto.randomBytes(10).toString('hex')+'.png'; fs.writeFileSync(path.join(IMAGES_DIR,name), Buffer.from(b64,'base64')); return name; }

function brandContext(){
  const b=db.prepare('SELECT * FROM brand WHERE id=1').get();
  const learned=db.prepare("SELECT note FROM style_memory WHERE kind='approved' ORDER BY id DESC LIMIT 8").all().map(r=>r.note);
  const avoided=db.prepare("SELECT note FROM style_memory WHERE kind='rejected' ORDER BY id DESC LIMIT 5").all().map(r=>r.note);
  let ctx=`Brand: ${b.name}. Tone: ${b.tone}. Primary colour: ${b.color1}, secondary: ${b.color2}.`;
  if(b.notes) ctx+=' Notes: '+b.notes;
  if(learned.length) ctx+=' Styles the client has approved before: '+learned.join(' | ')+'.';
  if(avoided.length) ctx+=' Avoid styles like: '+avoided.join(' | ')+'.';
  return { b, ctx };
}

// ---- auth endpoints ----
app.post('/api/login/verify', loginLimiter, (req,res)=>{
  const {username,password}=req.body||{};
  if(!username) return res.status(400).json({error:'Username required'});
  if(!password) return res.status(400).json({error:'Password required'});
  const u=db.prepare('SELECT id,name,role FROM users WHERE username=? AND password=?').get(String(username),String(password));
  if(!u) return res.status(401).json({error:'Invalid username or password'});
  res.json({ok:true, user:u});
});
app.post('/api/login', loginLimiter, (req,res)=>{
  const {username,password,apiKey}=req.body||{};
  if(!username) return res.status(400).json({error:'Username required'});
  if(!password) return res.status(400).json({error:'Password required'});
  if(!apiKey || !apiKey.trim()) return res.status(400).json({error:'Please enter your OpenAI API key'});
  const u=db.prepare('SELECT id,name,role FROM users WHERE username=? AND password=?').get(String(username),String(password));
  if(!u) return res.status(401).json({error:'Invalid username or password'});
  const token=newSession(u.role, apiKey.trim());
  res.json({ok:true, user:u, token});
});
app.post('/api/logout', auth, (req,res)=>{ sessions.delete(req.get('x-auth-token')); res.json({ok:true}); });

// ---- brand settings ----
app.get('/api/brand', auth, (req,res)=>res.json(db.prepare('SELECT * FROM brand WHERE id=1').get()));
app.post('/api/brand', auth, (req,res)=>{ const {name,tone,color1,color2,notes}=req.body||{};
  db.prepare('UPDATE brand SET name=?,tone=?,color1=?,color2=?,notes=? WHERE id=1').run(name||'MUHSQ',tone||'',color1||'#d4af37',color2||'#1c1116',notes||'');
  res.json({ok:true}); });

// ---- generate 3 options for a brief ----
app.post('/api/generate', auth, async (req,res)=>{
  const brief=String((req.body||{}).brief||'').trim().slice(0,200);
  if(!brief) return res.status(400).json({error:'Enter a campaign brief'});
  const { ctx }=brandContext();
  const draftId=db.prepare('INSERT INTO drafts (brief) VALUES (?)').run(brief).lastInsertRowid;
  const angles=['a clean editorial flat-lay style','a bold festive poster style','a soft minimal lifestyle style'];
  try{
    const out=[];
    for(let i=0;i<3;i++){
      const prompt=`Instagram post graphic for a Lahore fashion clothing brand. ${ctx} Campaign: "${brief}". Style: ${angles[i]}. Leave clear open space for a garment photo to be placed in later — do not invent a person or clothing item, focus on background, colour, texture and any text/badges. No watermarks.`;
      const b64=await openaiImage(req.session.apiKey, prompt);
      const file=saveImage(b64);
      const caption=await openaiCaption(req.session.apiKey,
        'You write short, punchy Instagram captions for a premium Pakistani fashion brand based in Lahore. Reply with just the caption text, under 220 characters, warm and elegant, then on a new line 3-5 relevant hashtags starting with #.',
        `Campaign: ${brief}. Brand context: ${ctx}`);
      const [cap,tagsLine]=caption.split('\n').map(s=>s.trim());
      const oid=db.prepare('INSERT INTO options (draft_id,image_file,prompt,caption,tags) VALUES (?,?,?,?,?)').run(draftId,file,prompt,cap||caption,tagsLine||'').lastInsertRowid;
      out.push({id:oid,image:'/media/'+file,caption:cap||caption,tags:tagsLine||'',status:'pending'});
    }
    res.json({ok:true,draft_id:draftId,options:out});
  }catch(e){ res.status(400).json({error:e.message}); }
});

// ---- edit one option by prompt instruction (re-generates with the instruction appended) ----
app.post('/api/options/:id/edit', auth, async (req,res)=>{
  const id=+req.params.id; const instruction=String((req.body||{}).instruction||'').trim().slice(0,200);
  if(!instruction) return res.status(400).json({error:'Describe what to change'});
  const o=db.prepare('SELECT * FROM options WHERE id=?').get(id); if(!o) return res.status(404).json({error:'Not found'});
  try{
    const newPrompt=o.prompt+` Additional instruction from the brand: ${instruction}.`;
    const b64=await openaiImage(req.session.apiKey,newPrompt);
    const file=saveImage(b64);
    const edits=JSON.parse(o.edits||'[]'); edits.push(instruction);
    db.prepare('UPDATE options SET image_file=?,prompt=?,edits=? WHERE id=?').run(file,newPrompt,JSON.stringify(edits),id);
    res.json({ok:true,option:{id,image:'/media/'+file,caption:o.caption,tags:o.tags,status:o.status,edits}});
  }catch(e){ res.status(400).json({error:e.message}); }
});

// ---- approve / reject (this IS the learning loop: feeds style_memory) ----
app.post('/api/options/:id/approve', auth, (req,res)=>{
  const id=+req.params.id; const o=db.prepare('SELECT * FROM options WHERE id=?').get(id); if(!o) return res.status(404).json({error:'Not found'});
  db.prepare("UPDATE options SET status='approved' WHERE id=?").run(id);
  db.prepare("INSERT INTO style_memory (kind,note) VALUES ('approved',?)").run(o.caption.slice(0,140));
  res.json({ok:true}); });
app.post('/api/options/:id/reject', auth, (req,res)=>{
  const id=+req.params.id; const reason=String((req.body||{}).reason||'').slice(0,140);
  const o=db.prepare('SELECT * FROM options WHERE id=?').get(id); if(!o) return res.status(404).json({error:'Not found'});
  db.prepare("UPDATE options SET status='rejected' WHERE id=?").run(id);
  db.prepare("INSERT INTO style_memory (kind,note) VALUES ('rejected',?)").run(reason||o.caption.slice(0,140));
  res.json({ok:true}); });
app.post('/api/options/:id/posted', auth, (req,res)=>{ db.prepare("UPDATE options SET status='posted' WHERE id=?").run(+req.params.id); res.json({ok:true}); });

// ---- stats + gallery ----
app.get('/api/stats', auth, (req,res)=>{
  const g=s=>db.prepare(s).get().c;
  res.json({
    approved:g("SELECT COUNT(*) c FROM options WHERE status='approved'"),
    posted:g("SELECT COUNT(*) c FROM options WHERE status='posted'"),
    rejected:g("SELECT COUNT(*) c FROM options WHERE status='rejected'"),
    learned:g("SELECT COUNT(*) c FROM style_memory"),
  });
});
app.get('/api/gallery', auth, (req,res)=>{
  const rows=db.prepare("SELECT id,image_file,caption,tags,status,created_at FROM options WHERE status!='pending' ORDER BY id DESC LIMIT 30").all();
  res.json(rows.map(r=>({id:r.id,image:'/media/'+r.image_file,caption:r.caption,tags:r.tags,status:r.status,created_at:r.created_at})));
});

app.get('/',(req,res)=>res.sendFile(path.join(__dirname,'index.html')));

const PORT=process.env.PORT||3000;
app.listen(PORT,()=>console.log('MUHSQ AI Creative Agent on '+PORT));
