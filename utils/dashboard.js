const crypto = require('crypto');
const { query } = require('../database/database');
const { DEFAULT_SETTINGS, normalizeSettings } = require('./config');

const sessions = new Map();
const oauthStates = new Map();
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;

function baseUrl(req) {
  return process.env.DASHBOARD_URL || `${req.protocol}://${req.get('host')}`;
}
function cookie(name, value, maxAge) {
  return `${name}=${value}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
}
function newToken() { return crypto.randomBytes(32).toString('hex'); }

async function discord(path, token, options={}) {
  const res = await fetch(`https://discord.com/api/v10${path}`, {
    ...options, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  if (!res.ok) throw new Error(`Discord API ${res.status}`);
  return res.json();
}

function isManager(guild) {
  const permissions = BigInt(guild.permissions || '0');
  return (permissions & 0x8n) !== 0n || (permissions & 0x20n) !== 0n;
}

function html(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>
body{font-family:system-ui,sans-serif;max-width:1000px;margin:40px auto;padding:0 20px;background:#111;color:#eee}a,button{color:#fff}a{display:inline-block;padding:10px 14px;background:#5865f2;border-radius:8px;text-decoration:none;margin:4px}section{background:#1b1b1b;padding:20px;border-radius:12px;margin:16px 0}label{display:block;margin:12px 0}input,select{padding:9px;border-radius:7px;border:1px solid #555;background:#222;color:#fff}button{background:#5865f2;border:0;padding:10px 16px;border-radius:8px;cursor:pointer}code{background:#222;padding:3px 6px;border-radius:5px}
</style></head><body>${body}</body></html>`;
}

function dashboard(app, client) {
  app.get('/dashboard', async (req,res) => {
    const sid=req.headers.cookie?.match(/tbfs=([^;]+)/)?.[1];
    const session=sid && sessions.get(sid);
    if (!session || session.expires < Date.now()) {
      const clientId=process.env.CLIENT_ID;
      const secret=process.env.DISCORD_CLIENT_SECRET;
      if (!clientId || !secret) return res.status(503).send(html('Dashboard unavailable','<h1>Dashboard not configured</h1><p>Set <code>DISCORD_CLIENT_SECRET</code> and <code>DASHBOARD_URL</code> on Render.</p>'));
      const state=newToken(); oauthStates.set(state,{created:Date.now()});
      const redirect=`${baseUrl(req)}/dashboard/callback`;
      return res.redirect('https://discord.com/oauth2/authorize?client_id='+encodeURIComponent(clientId)+'&response_type=code&redirect_uri='+encodeURIComponent(redirect)+'&scope=identify%20guilds');
    }
    try {
      const guilds=await discord('/users/@me/guilds',session.accessToken);
      const managed=guilds.filter(isManager);
      res.send(html('The Bot Father Dashboard',`<h1>🤖 The Bot Father</h1><p>Server control panel</p><section><h2>Your servers</h2>${managed.map(g=>`<a href="/dashboard/guild/${g.id}">${g.name}</a>`).join('')||'<p>No servers where you have Manage Server.</p>'}</section><p><a href="/dashboard/logout">Log out</a></p>`));
    } catch { sessions.delete(sid); res.redirect('/dashboard'); }
  });

  app.get('/dashboard/callback', async (req,res) => {
    const {code,state}=req.query;
    if (!code) return res.status(400).send('Missing OAuth code.');
    if (state && !oauthStates.has(state)) return res.status(400).send('Invalid OAuth state.');
    if (state) oauthStates.delete(state);
    try {
      const redirect=`${baseUrl(req)}/dashboard/callback`;
      const body=new URLSearchParams({client_id:process.env.CLIENT_ID,client_secret:process.env.DISCORD_CLIENT_SECRET,grant_type:'authorization_code',code,redirect_uri:redirect});
      const tokenRes=await fetch('https://discord.com/api/v10/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});
      if(!tokenRes.ok) throw new Error('OAuth token exchange failed');
      const token=await tokenRes.json();
      const sid=newToken(); sessions.set(sid,{accessToken:token.access_token,expires:Date.now()+SESSION_TTL});
      res.setHeader('Set-Cookie',cookie('tbfs',sid,SESSION_TTL/1000)); res.redirect('/dashboard');
    } catch { res.status(502).send('Discord sign-in failed. Check the dashboard OAuth settings.'); }
  });

  app.get('/dashboard/logout',(req,res)=>{const sid=req.headers.cookie?.match(/tbfs=([^;]+)/)?.[1]; if(sid)sessions.delete(sid); res.setHeader('Set-Cookie',cookie('tbfs','',0)); res.redirect('/dashboard');});

  app.get('/dashboard/guild/:id', async (req,res) => {
    const sid=req.headers.cookie?.match(/tbfs=([^;]+)/)?.[1], session=sid&&sessions.get(sid);
    if(!session||session.expires<Date.now()) return res.redirect('/dashboard');
    try {
      const guilds=await discord('/users/@me/guilds',session.accessToken); const guild=guilds.find(g=>g.id===req.params.id);
      if(!guild||!isManager(guild)) return res.status(403).send('You do not have permission to manage this server.');
      const r=await query('SELECT * FROM guild_settings WHERE guild_id=$1',[guild.id]);
      const s=normalizeSettings(r.rows[0]);
      const checks=[['welcome_enabled','Welcome'],['goodbye_enabled','Goodbye'],['welcome_dm_enabled','Welcome DMs'],['verification_enabled','Verification'],['automod_enabled','AutoMod'],['level_enabled','Levels']];
      res.send(html(guild.name,`<h1>⚙️ ${guild.name}</h1><a href="/dashboard">← Servers</a><section><h2>Features</h2>${checks.map(([k,n])=>`<label><input type="checkbox" data-key="${k}" ${s[k]?'checked':''}> ${n}</label>`).join('')}<button onclick="save()">Save settings</button></section><section><p>Logging channel: <code>${s.log_channel_id||'not set'}</code></p><p>Suggestion channel: <code>${s.suggestion_channel_id||'not set'}</code></p><p>Ticket category: <code>${s.ticket_category_id||'not set'}</code></p></section><script>
async function save(){const settings={};document.querySelectorAll('[data-key]').forEach(x=>settings[x.dataset.key]=x.checked);const r=await fetch('/api/dashboard/guild/${guild.id}/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(settings)});alert(r.ok?'Saved!':'Save failed');}
</script>`));
    } catch { res.status(500).send('Dashboard error.'); }
  });

  app.put('/api/dashboard/guild/:id/settings', async (req,res) => {
    const sid=req.headers.cookie?.match(/tbfs=([^;]+)/)?.[1], session=sid&&sessions.get(sid);
    if(!session||session.expires<Date.now()) return res.status(401).json({error:'Not signed in'});
    try {
      const guilds=await discord('/users/@me/guilds',session.accessToken); const guild=guilds.find(g=>g.id===req.params.id);
      if(!guild||!isManager(guild)) return res.status(403).json({error:'Forbidden'});
      const allowed=['welcome_enabled','goodbye_enabled','welcome_dm_enabled','verification_enabled','automod_enabled','level_enabled'];
      const entries=allowed.filter(k=>typeof req.body?.[k]==='boolean').map(k=>[k,req.body[k]]);
      if(!entries.length)return res.status(400).json({error:'No valid settings'});
      for(const [key,value] of entries) await query(`INSERT INTO guild_settings(guild_id,${key},updated_at) VALUES($1,$2,NOW()) ON CONFLICT(guild_id) DO UPDATE SET ${key}=EXCLUDED.${key},updated_at=NOW()`,[guild.id,value]);
      res.json({ok:true});
    } catch { res.status(500).json({error:'Could not save settings'}); }
  });
}
module.exports={dashboard};