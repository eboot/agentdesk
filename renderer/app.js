'use strict';
/* AgentDesk — renderer.
   Satu aplikasi, banyak agen. Tiap agen = nama + ikon + system prompt (+ model & tool opsional).
   Backend: API apa pun yang OpenAI-compatible (OpenAI, Ollama, 9Router, dll). */

const $ = (s) => document.querySelector(s);
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmtTime = (ts) => new Date(ts).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

const COLORS = ['#f59e0b', '#3b82f6', '#8b5cf6', '#10b981', '#06b6d9', '#ef4444', '#64748b', '#ec4899'];

/* ================= Markdown mini ================= */
function md(src) {
  const codeBlocks = [];
  src = String(src).replace(/```[\s\S]*?(?:```|$)/g, (m) => {
    codeBlocks.push(m); return '\u0000' + (codeBlocks.length - 1) + '\u0000';
  });
  const inline = (t) => t
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|\W)\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const lines = esc(src).split('\n');
  let html = '', inUl = false, inOl = false, inQ = false;
  const close = () => {
    if (inUl) { html += '</ul>'; inUl = false; }
    if (inOl) { html += '</ol>'; inOl = false; }
    if (inQ) { html += '</blockquote>'; inQ = false; }
  };
  for (const line of lines) {
    let m;
    if (/^\u0000\d+\u0000$/.test(line.trim())) {
      close();
      const raw = codeBlocks[+line.trim().slice(1, -1)].replace(/^```\w*\n?/, '').replace(/```$/, '');
      html += '<pre><code>' + esc(raw).replace(/\n$/, '') + '</code></pre>';
      continue;
    }
    if ((m = line.match(/^(#{1,6})\s+(.*)/))) { close(); html += `<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`; continue; }
    if (/^---+$/.test(line.trim())) { close(); html += '<hr>'; continue; }
    if ((m = line.match(/^&gt;\s?(.*)/))) {
      if (!inQ) { close(); html += '<blockquote>'; inQ = true; }
      html += inline(m[1]) + '<br>'; continue;
    }
    if ((m = line.match(/^\s*[-*]\s+(.*)/))) {
      if (inOl || inQ) close();
      if (!inUl) { html += '<ul>'; inUl = true; }
      html += `<li>${inline(m[1])}</li>`; continue;
    }
    if ((m = line.match(/^\s*\d+[.)]\s+(.*)/))) {
      if (inUl || inQ) close();
      if (!inOl) { html += '<ol>'; inOl = true; }
      html += `<li>${inline(m[1])}</li>`; continue;
    }
    if (line.trim() === '') { close(); continue; }
    close(); html += `<p>${inline(line)}</p>`;
  }
  close();
  return html;
}

/* ================= State ================= */
let state = { settings: null, agents: [], chats: {}, activeAgentId: null };
let streaming = false;

function defaultAgents() {
  return [
    { id: uid(), name: 'Chief', icon: '🎯', color: '#f59e0b', tools: false, model: '', temperature: null,
      system: 'You are Chief, the coordinator of this multi-agent workspace. Understand the user\'s goal, break it into steps, and point them to the right specialist agent for each part. Be concise, decisive, and proactive. Track overall progress.' },
    { id: uid(), name: 'Sales Outbound', icon: '💼', color: '#3b82f6', tools: false, model: '', temperature: null,
      system: 'You are Sales Outbound, a B2B sales assistant. Draft outreach messages, follow-ups, and call scripts in the user\'s voice: short, confident, human — never robotic. Ask for the prospect context you need before drafting.' },
    { id: uid(), name: 'Inbox Manager', icon: '📥', color: '#8b5cf6', tools: false, model: '', temperature: null,
      system: 'You are Inbox Manager. You triage email: summarize threads, draft replies, flag what needs the user\'s decision, and keep the inbox at zero. Be ruthless about what is noise versus what matters.' },
    { id: uid(), name: 'Account Manager', icon: '👔', color: '#10b981', tools: false, model: '', temperature: null,
      system: 'You are Account Manager. You track client relationships, prepare meeting notes, draft check-ins, and spot upsell or churn risks. Warm, professional, detail-oriented.' },
    { id: uid(), name: 'Talent Scout', icon: '🔍', color: '#06b6d9', tools: false, model: '', temperature: null,
      system: 'You are Talent Scout. You draft job posts, candidate outreach, and interview questions. Write in the user\'s voice and keep every message personal — never templated.' },
    { id: uid(), name: 'Expense Manager', icon: '🧾', color: '#ef4444', tools: false, model: '', temperature: null,
      system: 'You are Expense Manager. Log expenses from pasted receipts or descriptions, categorize them, and produce clean summaries. Be precise with numbers.' },
    { id: uid(), name: 'Computer', icon: '💻', color: '#64748b', tools: true, model: '', temperature: null,
      system: 'You are Computer, an agent with access to the user\'s machine via the run_command tool. Inspect files, run scripts, and automate local tasks. Always explain what a command will do before calling it, one command at a time.' },
    { id: uid(), name: 'Muse', icon: '✨', color: '#ec4899', tools: false, model: 'muse-spark', temperature: null,
      baseUrl: 'https://kabe9router.pages.dev/v1', apiKey: '', builtIn: 'muse',
      system: 'You are Muse, the user\'s warm and capable personal AI assistant. Help with anything: answer questions, write and debug code, draft messages, explain things clearly. Be genuine and resourceful — never performative.' },
  ];
}

const activeAgent = () => state.agents.find((a) => a.id === state.activeAgentId) || state.agents[0];
const agentChats = (id) => (state.chats[id] = state.chats[id] || []);
const pushMsg = (agentId, msg) => { agentChats(agentId).push(msg); };

async function saveConfig() {
  await window.api.storeSet('config.json', {
    settings: state.settings, agents: state.agents, activeAgentId: state.activeAgentId,
  });
}
const saveChats = () => window.api.storeSet('chats.json', state.chats);

/* ================= Setup (first run) ================= */
const PRESETS = {
  openai: { base: 'https://api.openai.com/v1', key: '', model: 'gpt-4o-mini' },
  ollama: { base: 'http://localhost:11434/v1', key: 'ollama', model: 'llama3.1' },
  custom: { base: '', key: '', model: '' },
};

async function testConnection(base, key) {
  const r = await fetch(base.replace(/\/$/, '') + '/models', {
    headers: key ? { Authorization: 'Bearer ' + key } : {},
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  return (j.data || []).length;
}

function showSetup() {
  $('#setup').classList.remove('hidden');
  $('#app').classList.add('hidden');
  document.querySelectorAll('.preset').forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll('.preset').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      const p = PRESETS[b.dataset.preset];
      $('#su-base').value = p.base; $('#su-key').value = p.key; $('#su-model').value = p.model;
    };
  });
  $('#su-test').onclick = async () => {
    const msg = $('#su-msg');
    msg.textContent = 'Mengetes koneksi...';
    try {
      const n = await testConnection($('#su-base').value.trim(), $('#su-key').value.trim());
      msg.textContent = '✔ Koneksi OK — ' + n + ' model tersedia.';
    } catch (e) { msg.textContent = '✖ Gagal: ' + e.message; }
  };
  $('#su-start').onclick = async () => {
    const base = $('#su-base').value.trim(), key = $('#su-key').value.trim(), model = $('#su-model').value.trim();
    if (!base || !key || !model) { $('#su-msg').textContent = 'Isi base URL, API key, dan model dulu.'; return; }
    try { await testConnection(base, key); }
    catch (e) { $('#su-msg').textContent = '✖ Koneksi gagal: ' + e.message + ' — periksa lagi sebelum lanjut.'; return; }
    state.settings = { baseUrl: base, apiKey: key, model, temperature: 0.7, streamMode: 'auto' };
    state.agents = defaultAgents();
    state.activeAgentId = state.agents[0].id;
    await saveConfig();
    showApp();
  };
}

function showApp() {
  $('#setup').classList.add('hidden');
  $('#app').classList.remove('hidden');
  renderAgents();
  renderHeader();
  if (state.activeAgentId === '__group__') renderGroupMessages();
  else renderMessages();
}

/* ================= Sidebar & header ================= */
function renderAgents() {
  const q = ($('#agent-search').value || '').toLowerCase();
  const list = $('#agent-list');
  list.innerHTML = '';
  // Baris Grup Chat — selalu paling atas
  if (!q || 'grup chat'.includes(q)) {
    const gmsgs = agentChats('__group__').filter((m) => !m.error);
    const glast = gmsgs[gmsgs.length - 1];
    const grow = document.createElement('div');
    grow.className = 'agent-row' + (state.activeAgentId === '__group__' ? ' active' : '');
    grow.innerHTML =
      `<div class="agent-ava" style="background:#f5b30122;border:1px solid #f5b30155">👥</div>
       <div class="agent-meta"><div class="agent-name">Grup Chat</div>
       <div class="agent-snippet">${glast ? esc((glast.role === 'user' ? 'Kamu: ' : glast.name + ': ') + glast.content.slice(0, 50)) : 'Semua agen dalam satu ruangan'}</div></div>
       <div class="agent-time">${glast ? fmtTime(glast.ts) : ''}</div>`;
    grow.onclick = async () => {
      state.activeAgentId = '__group__';
      await saveConfig();
      renderAgents(); renderHeader(); renderGroupMessages();
    };
    list.appendChild(grow);
  }
  for (const a of state.agents) {
    if (q && !a.name.toLowerCase().includes(q)) continue;
    const msgs = agentChats(a.id).filter((m) => !m.error);
    const last = msgs[msgs.length - 1];
    const row = document.createElement('div');
    row.className = 'agent-row' + (a.id === state.activeAgentId ? ' active' : '');
    row.innerHTML =
      `<div class="agent-ava" style="background:${a.color}22;border:1px solid ${a.color}55">${esc(a.icon)}</div>
       <div class="agent-meta"><div class="agent-name">${esc(a.name)}</div>
       <div class="agent-snippet">${last ? esc(last.content.slice(0, 60)) : 'Belum ada percakapan'}</div></div>
       <div class="agent-time">${last ? fmtTime(last.ts) : ''}</div>`;
    row.onclick = async () => {
      state.activeAgentId = a.id;
      await saveConfig();
      renderAgents(); renderHeader(); renderMessages();
    };
    list.appendChild(row);
  }
}

function renderHeader() {
  if (state.activeAgentId === '__group__') {
    $('#chat-header').innerHTML =
      `<div class="agent-ava" style="background:#f5b30122;border:1px solid #f5b30155">👥</div>
       <h2>Grup Chat</h2><div class="spacer"></div>
       <button class="icon-btn" id="btn-group-manage" title="Pilih agen peserta">⚙ Kelola</button>
       <button class="icon-btn" id="btn-clear" title="Hapus riwayat grup">🗑</button>`;
    $('#btn-group-manage').onclick = openGroupModal;
    $('#btn-clear').onclick = async () => {
      if (!confirm('Hapus semua riwayat grup chat?')) return;
      state.chats['__group__'] = [];
      await saveChats();
      renderGroupMessages(); renderAgents();
    };
    return;
  }
  const a = activeAgent();
  if (!a) return;
  $('#chat-header').innerHTML =
    `<div class="agent-ava" style="background:${a.color}22;border:1px solid ${a.color}55">${esc(a.icon)}</div>
     <h2>${esc(a.name)}</h2><div class="spacer"></div>
     <button class="icon-btn" id="btn-edit-agent" title="Edit agen">✏️ Edit</button>
     <button class="icon-btn" id="btn-clear" title="Hapus riwayat chat">🗑</button>`;
  $('#btn-edit-agent').onclick = () => openAgentModal(a);
  $('#btn-clear').onclick = async () => {
    if (!confirm('Hapus semua riwayat chat dengan ' + a.name + '?')) return;
    state.chats[a.id] = [];
    await saveChats();
    renderMessages(); renderAgents();
  };
}

/* ================= Chat ================= */
function scrollBottom() {
  const m = $('#messages');
  m.scrollTop = m.scrollHeight;
}

function renderMessages() {
  const a = activeAgent();
  const box = $('#messages');
  box.innerHTML = '';
  for (const m of agentChats(a.id)) {
    const div = document.createElement('div');
    div.className = 'msg ' + (m.role === 'user' ? 'user' : 'assistant') + (m.error ? ' error' : '');
    div.innerHTML = m.role === 'user' ? esc(m.content) : md(m.content);
    box.appendChild(div);
  }
  scrollBottom();
}

function renderGroupMessages() {
  const box = $('#messages');
  box.innerHTML = '';
  for (const m of agentChats('__group__')) {
    if (m.role === 'user') {
      const div = document.createElement('div');
      div.className = 'msg user';
      div.textContent = m.content;
      box.appendChild(div);
    } else {
      const wrap = document.createElement('div');
      wrap.className = 'msg assistant' + (m.error ? ' error' : '');
      wrap.innerHTML =
        `<div class="g-label"><span class="agent-ava sm" style="background:${m.color}22;border:1px solid ${m.color}55">${esc(m.icon || '🤖')}</span>` +
        `<strong>${esc(m.name || 'Agen')}</strong><span class="muted small">${fmtTime(m.ts)}</span></div>` +
        `<div>${m.error ? esc(m.content) : md(m.content)}</div>`;
      box.appendChild(wrap);
    }
  }
  scrollBottom();
}

function openGroupModal() {
  const m = openModal(
    `<h3>👥 Peserta Grup Chat</h3>
     <p class="muted small">Pilih agen yang ikut menjawab di grup chat, sesuai urutan di sidebar.</p>
     <div id="gm-list"></div>
     <div class="modal-btns">
       <button class="ghost" id="gm-cancel">Batal</button>
       <button class="primary" id="gm-save">Simpan</button>
     </div>`
  );
  const list = m.querySelector('#gm-list');
  for (const a of state.agents) {
    const lab = document.createElement('label');
    lab.className = 'check';
    lab.innerHTML = `<input type="checkbox" data-id="${a.id}" ${a.inGroup !== false ? 'checked' : ''}>` +
      `<span class="agent-ava sm" style="background:${a.color}22;border:1px solid ${a.color}55">${esc(a.icon)}</span> ${esc(a.name)}`;
    list.appendChild(lab);
  }
  m.querySelector('#gm-cancel').onclick = closeModal;
  m.querySelector('#gm-save').onclick = async () => {
    list.querySelectorAll('input[type=checkbox]').forEach((cb) => {
      const ag = state.agents.find((x) => x.id === cb.dataset.id);
      if (ag) ag.inGroup = cb.checked;
    });
    await saveConfig();
    closeModal();
  };
}

function updateSendBtn() {
  const b = $('#btn-send');
  b.disabled = streaming;
  b.textContent = streaming ? '⏳' : '➤';
}

/* --- baca respons SSE (streaming) --- */
async function readSSE(res, onToken) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '', content = '';
  const toolCalls = {};
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split('\n');
    buf = parts.pop();
    for (const line of parts) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      const data = t.slice(5).trim();
      if (data === '[DONE]') continue;
      try {
        const delta = JSON.parse(data).choices?.[0]?.delta;
        if (!delta) continue;
        if (delta.content) { content += delta.content; onToken(content); }
        for (const tc of delta.tool_calls || []) {
          const i = tc.index ?? 0;
          toolCalls[i] = toolCalls[i] || { id: '', name: '', args: '' };
          if (tc.id) toolCalls[i].id = tc.id;
          if (tc.function?.name) toolCalls[i].name = tc.function.name;
          if (tc.function?.arguments) toolCalls[i].args += tc.function.arguments;
        }
      } catch (e) { /* abaikan baris SSE yang rusak */ }
    }
  }
  return { content, toolCalls };
}

/* --- parse respons JSON biasa (non-streaming) --- */
function extractNonStream(j) {
  const msg = (j.choices && j.choices[0] && j.choices[0].message) || {};
  const content = msg.content || '';
  const toolCalls = {};
  (msg.tool_calls || []).forEach((tc, i) => {
    toolCalls[tc.index ?? i] = {
      id: tc.id || '',
      name: (tc.function && tc.function.name) || '',
      args: (tc.function && tc.function.arguments) || '',
    };
  });
  return { content, toolCalls };
}

/* --- ke API (OpenAI-compatible), dengan fallback non-streaming ---
   Beberapa backend (mis. muse-spark via muse-bridge) tidak mendukung SSE:
   mereka mengabaikan stream:true dan menjawab JSON biasa. Mode 'auto'
   mendeteksi itu dari content-type, dan mencoba ulang tanpa stream kalau
   server menolak stream:true. */
async function complete(agent, msgs, useTools, onToken) {
  const base = (agent.baseUrl || state.settings.baseUrl).replace(/\/$/, '');
  const key = agent.apiKey || state.settings.apiKey;
  const mode = state.settings.streamMode || 'auto'; // 'auto' | 'stream' | 'nostream'
  const body = {
    model: agent.model || state.settings.model,
    messages: msgs,
    temperature: agent.temperature ?? state.settings.temperature ?? 0.7,
  };
  if (useTools) {
    body.tools = [{
      type: 'function',
      function: {
        name: 'run_command',
        description: 'Run a shell command on the user\'s computer. Use only when it genuinely helps the task. The user approves every command before it runs.',
        parameters: {
          type: 'object',
          properties: { command: { type: 'string', description: 'The shell command to run' } },
          required: ['command'],
        },
      },
    }];
  }
  async function post(stream) {
    const res = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
      body: JSON.stringify(Object.assign({}, body, { stream })),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} — ${t.slice(0, 200)}`);
    }
    return res;
  }
  async function viaJSON(res) {
    return extractNonStream(await res.json());
  }
  if (mode === 'nostream') return viaJSON(await post(false));
  try {
    const res = await post(true);
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('text/event-stream')) return readSSE(res, onToken);
    // Server mengabaikan stream:true dan menjawab JSON biasa (mis. muse-bridge).
    return viaJSON(res);
  } catch (e) {
    if (mode === 'stream') throw e;
    // Mode auto: kalau streaming gagal (mis. server menolak stream:true),
    // coba sekali lagi tanpa streaming sebelum menyerah.
    return viaJSON(await post(false));
  }
}

/* --- kartu persetujuan (seperti "Action needed" di screenshot) --- */
function askApproval(cmd) {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'action-card';
    el.innerHTML =
      '<div><span class="badge">⚡ Action needed</span></div>' +
      '<div class="action-title"><strong>Computer</strong> ingin menjalankan perintah ini:</div>' +
      '<pre><code>' + esc(cmd) + '</code></pre>' +
      '<div class="action-btns"><button class="primary" data-a="yes">Jalankan</button>' +
      '<button class="ghost" data-a="no">Lewati</button></div>';
    $('#messages').appendChild(el);
    scrollBottom();
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const ok = b.dataset.a === 'yes';
      el.querySelector('.action-btns').innerHTML =
        '<span class="muted">' + (ok ? '✔ Dijalankan' : '✖ Dilewati') + '</span>';
      resolve(ok);
    });
  });
}

// Satu giliran agen: bubble + tool loop. Mengembalikan teks gabungan (tidak menyimpan ke state).
async function agentTurn(agent, msgs) {
  let combined = '';
  for (let round = 0; round < 6; round++) {
    // bubble sementara: terisi progresif saat streaming, atau "menunggu" saat non-streaming
    const bubble = document.createElement('div');
    bubble.className = 'msg assistant cursor';
    bubble.innerHTML = '<span class="muted">⏳ Menunggu jawaban…</span>';
    $('#messages').appendChild(bubble);
    scrollBottom();
    const { content, toolCalls } = await complete(
      agent, msgs, agent.tools && round < 5, (acc) => { bubble.innerHTML = md(acc); scrollBottom(); }
    );
    bubble.remove();
    const tcs = Object.values(toolCalls);
    if (content) combined += (combined ? '\n\n' : '') + content;
    if (!tcs.length) break;
    msgs.push({
      role: 'assistant', content: content || '',
      tool_calls: tcs.map((t) => ({ id: t.id, type: 'function', function: { name: t.name, arguments: t.args } })),
    });
    for (const t of tcs) {
      if (t.name === 'run_command') {
        let cmd = '';
        try { cmd = String(JSON.parse(t.args || '{}').command || ''); } catch (e) { /* abaikan */ }
        const approved = cmd ? await askApproval(cmd) : false;
        const out = approved && cmd
          ? await window.api.shellRun(cmd)
          : { ok: false, skipped: true, note: 'user skipped this command' };
        msgs.push({ role: 'tool', tool_call_id: t.id, content: JSON.stringify(out).slice(0, 6000) });
      } else {
        msgs.push({ role: 'tool', tool_call_id: t.id, content: JSON.stringify({ ok: false, note: 'unknown tool' }) });
      }
    }
  }
  return combined;
}

async function runAgent(agent) {
  const history = agentChats(agent.id)
    .filter((m) => !m.error).slice(-40)
    .map((m) => ({ role: m.role, content: m.content }));
  const lang = 'Always respond in the same language the user writes in (default: Indonesian).';
  const text = await agentTurn(agent,
    [{ role: 'system', content: (agent.system || 'You are a helpful assistant.') + '\n\n' + lang }, ...history]);
  if (text) pushMsg(agent.id, { role: 'assistant', content: text, ts: Date.now() });
  renderMessages();
  scrollBottom();
}

// Grup chat: tiap agen peserta menjawab bergiliran sesuai urutan sidebar.
// Tiap agen melihat seluruh percakapan (dengan label siapa bicara) dan
// merespons strictly sesuai jobdesk-nya sendiri.
async function runGroup() {
  const participants = state.agents.filter((a) => a.inGroup !== false);
  if (!participants.length) {
    const d = document.createElement('div');
    d.className = 'msg assistant';
    d.innerHTML = '<p class="muted">Belum ada agen yang ikut grup chat. Klik ⚙ Kelola di atas untuk memilih peserta.</p>';
    $('#messages').appendChild(d);
    scrollBottom();
    return;
  }
  for (const agent of participants) {
    const others = participants
      .filter((p) => p.id !== agent.id)
      .map((p) => `- ${p.icon} ${p.name}`).join('\n');
    const history = agentChats('__group__')
      .filter((m) => !m.error).slice(-30)
      .map((m) => m.role === 'user'
        ? { role: 'user', content: m.content }
        : { role: 'assistant', content: `[${m.name}]: ${m.content}` });
    const sys = (agent.system || 'You are a helpful assistant.')
      + '\n\nYou are in a GROUP CHAT with these fellow AI agents:\n' + (others || '(none)')
      + '\nRead the full conversation. Respond strictly according to your own role/jobdesk. '
      + 'Be concise and do not repeat what others already said — contribute only what your role uniquely adds. '
      + 'If your part is already covered, acknowledge it in one short sentence.'
      + '\n\nAlways respond in the same language the user writes in (default: Indonesian).';
    try {
      const text = await agentTurn(agent, [{ role: 'system', content: sys }, ...history]);
      if (text) {
        pushMsg('__group__', {
          role: 'agent', agentId: agent.id, name: agent.name,
          icon: agent.icon, color: agent.color, content: text, ts: Date.now(),
        });
      }
    } catch (err) {
      pushMsg('__group__', {
        role: 'agent', name: agent.name, icon: agent.icon, color: agent.color,
        content: '⚠️ Error: ' + err.message, ts: Date.now(), error: true,
      });
    }
    renderGroupMessages();
  }
  scrollBottom();
}

async function send() {
  if (streaming) return;
  const text = $('#input').value.trim();
  if (!text) return;
  const isGroup = state.activeAgentId === '__group__';
  $('#input').value = '';
  $('#input').style.height = 'auto';
  if (isGroup) {
    pushMsg('__group__', { role: 'user', content: text, ts: Date.now() });
    renderGroupMessages();
  } else {
    const agent = activeAgent();
    pushMsg(agent.id, { role: 'user', content: text, ts: Date.now() });
    renderMessages();
  }
  renderAgents();
  streaming = true;
  updateSendBtn();
  try {
    if (isGroup) await runGroup();
    else await runAgent(activeAgent());
  } catch (err) {
    if (isGroup) {
      pushMsg('__group__', { role: 'agent', name: 'Sistem', icon: '⚠️', color: '#64748b', content: '⚠️ Error: ' + err.message, ts: Date.now(), error: true });
      renderGroupMessages();
    } else {
      pushMsg(activeAgent().id, { role: 'assistant', content: '⚠️ Error: ' + err.message, ts: Date.now(), error: true });
      renderMessages();
    }
  }
  streaming = false;
  updateSendBtn();
  renderAgents();
  saveChats();
}

/* ================= Modal ================= */
function openModal(html) {
  const root = $('#modal-root');
  root.innerHTML = '<div class="modal-overlay"><div class="modal">' + html + '</div></div>';
  root.querySelector('.modal-overlay').addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) closeModal();
  });
  return root.querySelector('.modal');
}
const closeModal = () => { $('#modal-root').innerHTML = ''; };

function openAgentModal(agent) {
  const isNew = !agent;
  agent = agent || { id: uid(), name: '', icon: '🤖', color: COLORS[0], system: '', model: '', temperature: null, tools: false };
  const m = openModal(
    `<h3>${isNew ? 'Agen baru' : 'Edit agen'}</h3>
     <label>Nama<input id="am-name" value="${esc(agent.name)}" placeholder="cth: Riset Pasar"></label>
     <label>Ikon (emoji)<input id="am-icon" value="${esc(agent.icon)}" maxlength="4" style="width:90px"></label>
     <label>Backend tiap agen <span class="small">(kosongkan = pakai pengaturan global)</span></label>
     <div class="form-row">
       <div><label>Base URL<input id="am-base" value="${esc(agent.baseUrl || '')}" placeholder="https://api.openai.com/v1" autocomplete="off"></label></div>
       <div><label>Model<input id="am-model" value="${esc(agent.model || '')}" placeholder="default" autocomplete="off"></label></div>
     </div>
     <label>API Key<input id="am-key" type="password" value="${esc(agent.apiKey || '')}" placeholder="kosong = pakai global" autocomplete="off"></label>
     <label>Warna</label>
     <div class="color-pick" id="am-colors"></div>
     <label>Instruksi / system prompt<textarea id="am-system" placeholder="Peran dan cara kerja agen ini...">${esc(agent.system)}</textarea></label>
     <div class="form-row">
       <div><label>Temperature<input id="am-temp" type="number" step="0.1" min="0" max="2" value="${agent.temperature ?? ''}" placeholder="0.7"></label></div>
       <div><label>&nbsp;</label><label class="check" style="margin-top:6px"><input type="checkbox" id="am-tools" ${agent.tools ? 'checked' : ''}> Bisa jalankan perintah (tool)</label></div>
     </div>
     <div class="modal-btns">
       ${isNew ? '' : '<button class="danger" id="am-del">Hapus</button>'}
       <span style="flex:1"></span>
       <button class="ghost" id="am-cancel">Batal</button>
       <button class="primary" id="am-save">Simpan</button>
     </div>`
  );
  const colorsEl = m.querySelector('#am-colors');
  let selColor = agent.color;
  for (const c of COLORS) {
    const d = document.createElement('div');
    d.className = 'color-dot' + (c === selColor ? ' sel' : '');
    d.style.background = c;
    d.onclick = () => { selColor = c; colorsEl.querySelectorAll('.color-dot').forEach((x) => x.classList.remove('sel')); d.classList.add('sel'); };
    colorsEl.appendChild(d);
  }
  m.querySelector('#am-cancel').onclick = closeModal;
  m.querySelector('#am-save').onclick = async () => {
    agent.name = m.querySelector('#am-name').value.trim() || 'Agen';
    agent.icon = m.querySelector('#am-icon').value.trim() || '🤖';
    agent.color = selColor;
    agent.system = m.querySelector('#am-system').value.trim();
    agent.model = m.querySelector('#am-model').value.trim();
    agent.baseUrl = m.querySelector('#am-base').value.trim();
    agent.apiKey = m.querySelector('#am-key').value.trim();
    const t = parseFloat(m.querySelector('#am-temp').value);
    agent.temperature = isNaN(t) ? null : t;
    agent.tools = m.querySelector('#am-tools').checked;
    if (isNew) { state.agents.push(agent); state.activeAgentId = agent.id; }
    await saveConfig();
    closeModal();
    renderAgents(); renderHeader(); renderMessages();
  };
  const del = m.querySelector('#am-del');
  if (del) del.onclick = async () => {
    if (!confirm('Hapus agen "' + agent.name + '" beserta riwayat chatnya?')) return;
    state.agents = state.agents.filter((a) => a.id !== agent.id);
    delete state.chats[agent.id];
    if (state.activeAgentId === agent.id) state.activeAgentId = state.agents[0]?.id || null;
    await saveConfig(); await saveChats();
    closeModal();
    renderAgents(); renderHeader(); renderMessages();
  };
}

function openSettingsModal() {
  const s = state.settings;
  const m = openModal(
    `<h3>⚙ Pengaturan</h3>
     <label>Base URL (OpenAI-compatible)<input id="sm-base" value="${esc(s.baseUrl)}"></label>
     <label>API Key<input id="sm-key" type="password" value="${esc(s.apiKey)}"></label>
     <label>Model default<input id="sm-model" value="${esc(s.model)}"></label>
     <label>Temperature default<input id="sm-temp" type="number" step="0.1" min="0" max="2" value="${s.temperature ?? 0.7}"></label>
     <label>Mode streaming
       <select id="sm-stream">
         <option value="auto" ${(s.streamMode || 'auto') === 'auto' ? 'selected' : ''}>Otomatis (disarankan)</option>
         <option value="stream" ${s.streamMode === 'stream' ? 'selected' : ''}>Selalu streaming</option>
         <option value="nostream" ${s.streamMode === 'nostream' ? 'selected' : ''}>Tanpa streaming</option>
       </select>
     </label>
     <p class="muted small">Pilih "Tanpa streaming" kalau backend-mu tidak mendukung SSE (mis. muse-spark via muse-bridge — jawabannya datang utuh ~14 detik). Mode otomatis mendeteksi ini sendiri.</p>
     <p class="muted small">API key tersimpan lokal di komputer ini saja (tidak dikirim ke mana pun selain base URL di atas).</p>
     <p id="sm-msg" class="muted"></p>
     <div class="modal-btns">
       <button class="ghost" id="sm-test">Tes koneksi</button>
       <span style="flex:1"></span>
       <button class="ghost" id="sm-cancel">Batal</button>
       <button class="primary" id="sm-save">Simpan</button>
     </div>`
  );
  m.querySelector('#sm-cancel').onclick = closeModal;
  m.querySelector('#sm-test').onclick = async () => {
    m.querySelector('#sm-msg').textContent = 'Mengetes...';
    try {
      const n = await testConnection(m.querySelector('#sm-base').value.trim(), m.querySelector('#sm-key').value.trim());
      m.querySelector('#sm-msg').textContent = '✔ OK — ' + n + ' model tersedia.';
    } catch (e) { m.querySelector('#sm-msg').textContent = '✖ Gagal: ' + e.message; }
  };
  m.querySelector('#sm-save').onclick = async () => {
    state.settings = {
      baseUrl: m.querySelector('#sm-base').value.trim(),
      apiKey: m.querySelector('#sm-key').value.trim(),
      model: m.querySelector('#sm-model').value.trim(),
      temperature: parseFloat(m.querySelector('#sm-temp').value) || 0.7,
      streamMode: m.querySelector('#sm-stream').value,
    };
    await saveConfig();
    closeModal();
  };
}

/* ================= Init ================= */
/* Hook pengujian otomatis (dipakai test harness, bukan aplikasi). */
if (typeof window !== 'undefined') {
  window.__adk = {
    complete,
    setSettings(s) { state.settings = s; },
    getSettings() { return state.settings; },
  };
}
async function init() {
  $('#btn-send').onclick = send;
  $('#input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });
  $('#input').addEventListener('input', (e) => {
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 140) + 'px';
  });
  $('#btn-new-agent').onclick = () => openAgentModal(null);
  $('#btn-settings').onclick = openSettingsModal;
  $('#agent-search').addEventListener('input', renderAgents);

  const cfg = await window.api.storeGet('config.json', null);
  if (cfg && cfg.settings && cfg.settings.baseUrl) {
    state.settings = cfg.settings;
    state.agents = (cfg.agents && cfg.agents.length) ? cfg.agents : defaultAgents();
    state.activeAgentId = cfg.activeAgentId || state.agents[0].id;
    state.chats = await window.api.storeGet('chats.json', {});
    if (!state.agents.some((a) => a.builtIn === 'muse')) {
      state.agents.push(defaultAgents().find((a) => a.builtIn === 'muse'));
      await saveConfig();
    }
    showApp();
  } else {
    showSetup();
  }
}

init();
