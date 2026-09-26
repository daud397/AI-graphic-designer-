const Database=require('better-sqlite3'); const path=require('path'); const fs=require('fs');
const DB_PATH=process.env.DB_PATH||path.join(__dirname,'data','muhsq.db');
fs.mkdirSync(path.dirname(DB_PATH),{recursive:true});
const db=new Database(DB_PATH); db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, role TEXT, username TEXT, password TEXT, api_key TEXT);
CREATE TABLE IF NOT EXISTS brand (
  id INTEGER PRIMARY KEY CHECK (id=1), name TEXT DEFAULT 'MUHSQ', tone TEXT DEFAULT 'elegant, premium, warm',
  color1 TEXT DEFAULT '#d4af37', color2 TEXT DEFAULT '#1c1116', notes TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS drafts (id INTEGER PRIMARY KEY AUTOINCREMENT, brief TEXT, created_at TEXT DEFAULT (datetime('now','localtime')));
CREATE TABLE IF NOT EXISTS options (
  id INTEGER PRIMARY KEY AUTOINCREMENT, draft_id INTEGER, image_file TEXT, prompt TEXT, caption TEXT, tags TEXT,
  status TEXT DEFAULT 'pending', edits TEXT DEFAULT '[]', created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS style_memory (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT, note TEXT, created_at TEXT DEFAULT (datetime('now','localtime')));
`);
if(db.prepare('SELECT COUNT(*) c FROM users').get().c===0){
  db.prepare('INSERT INTO users (name,role,username,password) VALUES (?,?,?,?)').run('Hayan Ahmed','admin','Hayan ahmed','hayan@2004');
  console.log('[db] seeded default user: username=Hayan ahmed, password=hayan@2004');
}
if(db.prepare('SELECT COUNT(*) c FROM brand').get().c===0){ db.prepare('INSERT INTO brand (id) VALUES (1)').run(); }
module.exports={ db };
