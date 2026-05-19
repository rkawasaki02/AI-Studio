// ═══════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════
const API = '';  // same origin
let currentChatId = null;
let selectedModel = 'claude-opus';
let chatHistory = [];  // [{role, content, image_data, image_type}]
let pendingImages = []; // [{data: base64, type: mime, preview: url}]
let isStreaming = false;
let currentAudio = null;
let currentTTSBtn = null;

// ═══════════════════════════════════════════
//  UTILS
// ═══════════════════════════════════════════
function toast(msg, dur = 2000) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), dur);
}

function scrollToBottom(smooth = true) {
  const wrap = document.getElementById('chat-wrap');
  wrap.scrollTo({ top: wrap.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
}

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
}

function autoResize(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 240) + 'px';
}

// ═══════════════════════════════════════════
//  MODEL
// ═══════════════════════════════════════════
const MODEL_LABELS = {
  'gemini-flash': 'G·Flash',
  'gemini-thinking': 'G·Think',
  'claude-sonnet': 'C·Sonnet',
  'claude-opus': 'C·Opus',
};
const MODEL_INITIALS = {
  'gemini-flash': 'G',
  'gemini-thinking': 'G✦',
  'claude-sonnet': 'C',
  'claude-opus': 'C◆',
};

function selectModel(btn) {
  document.querySelectorAll('.model-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  selectedModel = btn.dataset.model;
}

// ═══════════════════════════════════════════
//  SIDEBAR TOGGLE
// ═══════════════════════════════════════════
function toggleSidebar() {
  const collapsed = document.getElementById('app').classList.toggle('sidebar-collapsed');
  document.getElementById('sidebar-overlay').classList.toggle('visible', !collapsed);
}

function closeSidebar() {
  document.getElementById('app').classList.add('sidebar-collapsed');
  document.getElementById('sidebar-overlay').classList.remove('visible');
}

// ═══════════════════════════════════════════
//  CHAT LIST
// ═══════════════════════════════════════════
async function loadChatList() {
  try {
    const res = await fetch(`${API}/api/chats`);
    const chats = await res.json();
    renderChatList(chats);
  } catch(e) { console.error(e); }
}

function renderChatList(chats) {
  const el = document.getElementById('chat-list');

  const starred = chats.filter(c => c.starred);
  const rest = chats.filter(c => !c.starred);

  let html = '';

  if (starred.length) {
    html += `<div class="sidebar-section-label">Starred</div>`;
    starred.forEach(c => html += chatItemHTML(c));
  }

  if (rest.length) {
    if (starred.length) html += `<div class="sidebar-section-label" style="margin-top:8px">Recents</div>`;
    rest.forEach(c => html += chatItemHTML(c));
  }

  el.innerHTML = html || `<div style="padding:16px 8px;font-size:12px;color:var(--text-muted)">まだチャットがありません</div>`;
}

function chatItemHTML(c) {
  const active = c.id === currentChatId ? 'active' : '';
  const starred = c.starred ? 'starred' : '';
  const icon = c.starred
    ? '<i class="ti ti-star-filled"></i>'
    : '<i class="ti ti-message"></i>';
  return `
    <div class="chat-item ${active} ${starred}" data-id="${c.id}" onclick="openChat('${c.id}')">
      <div class="chat-item-icon">${icon}</div>
      <div class="chat-item-name" id="chatname-${c.id}">${escapeHtml(c.name)}</div>
      <div class="chat-item-actions">
        <button class="chat-action-btn" title="名前変更" onclick="startRename(event,'${c.id}')"><i class="ti ti-pencil"></i></button>
        <button class="chat-action-btn" title="${c.starred ? 'スター解除' : 'スター'}" onclick="toggleStar(event,'${c.id}',${c.starred})"><i class="ti ti-star${c.starred ? '-filled' : ''}"></i></button>
        <button class="chat-action-btn" title="削除" onclick="deleteChat(event,'${c.id}')"><i class="ti ti-trash"></i></button>
      </div>
    </div>`;
}

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function openChat(id) {
  currentChatId = id;
  chatHistory = [];

  try {
    const res = await fetch(`${API}/api/chats/${id}`);
    const chat = await res.json();
    document.getElementById('topbar-title').textContent = chat.name || 'Chat';

    // Restore model
    if (chat.model) {
      const btn = document.querySelector(`.model-btn[data-model="${chat.model}"]`);
      if (btn) selectModel(btn);
    }

    // Restore messages
    const msgs = document.getElementById('chat-messages');
    msgs.innerHTML = '';

    for (const m of chat.messages || []) {
      chatHistory.push({ role: m.role, content: m.content });
      if (m.role === 'user') {
        appendUserMessage(m.content, null, m.ts);
      } else {
        appendAIMessage(m.content, m.model || chat.model, m.ts);
      }
    }

    scrollToBottom(false);
  } catch(e) { console.error(e); }

  // モバイルはチャット選択後サイドバーを閉じる
  if (isMobile) closeSidebar();
  loadChatList();
}

async function newChat() {
  currentChatId = null;
  chatHistory = [];
  pendingImages = [];
  document.getElementById('chat-messages').innerHTML = `
    <div id="welcome">
      <div class="welcome-logo">AI <span>Studio</span></div>
      <div class="welcome-sub">Gemini & Claude — powered by XAI voice</div>
      <div class="welcome-models">
        <div class="welcome-model-chip">Gemini Flash</div>
        <div class="welcome-model-chip">Gemini Thinking</div>
        <div class="welcome-model-chip">Claude Sonnet</div>
        <div class="welcome-model-chip">Claude Opus</div>
      </div>
    </div>`;
  document.getElementById('topbar-title').textContent = 'New Chat';
  document.getElementById('image-preview-strip').innerHTML = '';
  document.getElementById('image-preview-strip').classList.remove('has-images');
  loadChatList();
  document.getElementById('msg-input').focus();
}

async function deleteChat(e, id) {
  e.stopPropagation();
  if (!confirm('このチャットを削除しますか？')) return;
  await fetch(`${API}/api/chats/${id}`, { method: 'DELETE' });
  if (currentChatId === id) newChat();
  loadChatList();
  toast('削除しました');
}

async function toggleStar(e, id, current) {
  e.stopPropagation();
  await fetch(`${API}/api/chats/${id}/star`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ starred: !current })
  });
  loadChatList();
}

function startRename(e, id) {
  e.stopPropagation();
  const nameEl = document.getElementById(`chatname-${id}`);
  const current = nameEl.textContent;
  nameEl.innerHTML = `<input class="chat-name-input" value="${escapeHtml(current)}" />`;
  const inp = nameEl.querySelector('input');
  inp.focus(); inp.select();
  inp.addEventListener('blur', () => commitRename(id, inp.value));
  inp.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') inp.blur();
    if (ev.key === 'Escape') { nameEl.textContent = current; }
  });
}

async function commitRename(id, name) {
  if (!name.trim()) { loadChatList(); return; }
  await fetch(`${API}/api/chats/${id}/rename`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name.trim() })
  });
  if (currentChatId === id) document.getElementById('topbar-title').textContent = name.trim();
  loadChatList();
}

// ═══════════════════════════════════════════
//  IMAGE HANDLING
// ═══════════════════════════════════════════
function handleImageFiles(files) {
  for (const f of files) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target.result;
      const base64 = dataUrl.split(',')[1];
      const type = f.type;
      const id = Date.now() + Math.random();
      pendingImages.push({ id, data: base64, type, preview: dataUrl });
      renderImagePreviews();
    };
    reader.readAsDataURL(f);
  }
  document.getElementById('file-input').value = '';
}

function renderImagePreviews() {
  const strip = document.getElementById('image-preview-strip');
  if (!pendingImages.length) {
    strip.innerHTML = '';
    strip.classList.remove('has-images');
    return;
  }
  strip.classList.add('has-images');
  strip.innerHTML = pendingImages.map(img => `
    <div class="preview-thumb">
      <img src="${img.preview}" alt="">
      <button class="preview-remove" onclick="removeImage(${img.id})"><i class="ti ti-x"></i></button>
    </div>`).join('');
}

function removeImage(id) {
  pendingImages = pendingImages.filter(i => i.id !== id);
  renderImagePreviews();
}

// ═══════════════════════════════════════════
//  SEND MESSAGE
// ═══════════════════════════════════════════
async function sendMessage() {
  if (isStreaming) return;
  const input = document.getElementById('msg-input');
  const text = input.value.trim();
  if (!text && !pendingImages.length) return;

  // Remove welcome
  const welcome = document.getElementById('welcome');
  if (welcome) welcome.remove();

  // Build message
  const imageData = pendingImages.length ? pendingImages[0].data : null;
  const imageType = pendingImages.length ? pendingImages[0].type : null;

  // Append to history
  chatHistory.push({ role: 'user', content: text, image_data: imageData, image_type: imageType });

  // Display user message
  appendUserMessage(text, pendingImages.length ? pendingImages[0].preview : null);

  // Clear input
  input.value = '';
  autoResize(input);
  pendingImages = [];
  renderImagePreviews();

  // Append thinking indicator
  const thinkEl = appendThinking();

  isStreaming = true;
  document.getElementById('send-btn').disabled = true;

  try {
    const resp = await fetch(`${API}/api/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: currentChatId,
        model: selectedModel,
        messages: chatHistory.filter(m => m.content && m.content.trim() !== '')
      })
    });

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let aiEl = null;
    let fullText = '';
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const data = JSON.parse(line.slice(6));
          if (data.type === 'meta') {
            currentChatId = data.chat_id;
            if (data.name) document.getElementById('topbar-title').textContent = data.name;
            thinkEl.remove();
            aiEl = appendAIMessage('', selectedModel);
          } else if (data.type === 'text') {
            fullText += data.text;
            if (aiEl) renderAIContent(aiEl, fullText, true);
            // ユーザーが下部にいる時だけ自動スクロール
            const wrap = document.getElementById('chat-wrap');
            const isAtBottom = wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight < 120;
            if (isAtBottom) scrollToBottom(false);
          } else if (data.type === 'done') {
            if (aiEl) renderAIContent(aiEl, fullText, false);
            if (fullText.trim()) chatHistory.push({ role: 'assistant', content: fullText });
            scrollToBottom();
            loadChatList();
          } else if (data.type === 'error') {
            if (aiEl) renderAIContent(aiEl, `⚠️ Error: ${data.message}`, false);
            else thinkEl.remove();
          }
        } catch(e) {}
      }
    }
  } catch(e) {
    thinkEl.remove();
    toast('エラーが発生しました: ' + e.message);
  }

  isStreaming = false;
  document.getElementById('send-btn').disabled = false;
  document.getElementById('msg-input').focus();
}

// ═══════════════════════════════════════════
//  RENDER MESSAGES
// ═══════════════════════════════════════════
function appendUserMessage(text, imagePreview, ts) {
  const msgs = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = 'message-group user';
  div.innerHTML = `
    <div class="message-row">
      <div class="msg-avatar user">You</div>
      <div class="msg-content">
        <div class="msg-meta">
          <span class="msg-role-label">You</span>
          <span class="msg-time">${ts ? formatTime(ts) : formatTime(new Date().toISOString())}</span>
        </div>
        ${imagePreview ? `<img class="msg-image" src="${imagePreview}" alt="Attached image">` : ''}
        <div class="msg-body">${escapeHtml(text).replace(/\n/g,'<br>')}</div>
      </div>
    </div>`;
  msgs.appendChild(div);
  scrollToBottom();
  return div;
}

function appendThinking() {
  const msgs = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = 'message-group ai';
  div.innerHTML = `
    <div class="message-row">
      <div class="msg-avatar ai">…</div>
      <div class="msg-content">
        <div class="thinking-dots"><span></span><span></span><span></span></div>
      </div>
    </div>`;
  msgs.appendChild(div);
  scrollToBottom();
  return div;
}

function appendAIMessage(text, model, ts) {
  const msgs = document.getElementById('chat-messages');
  const div = document.createElement('div');
  div.className = 'message-group ai';
  div.dataset.model = model || selectedModel;

  const m = model || selectedModel;
  const label = MODEL_LABELS[m] || m;
  const initial = MODEL_INITIALS[m] || 'AI';
  const timeStr = ts ? formatTime(ts) : formatTime(new Date().toISOString());

  div.innerHTML = `
    <div class="message-row">
      <div class="msg-avatar ai" data-model="${m}">${initial}</div>
      <div class="msg-content">
        <div class="msg-meta">
          <span class="msg-role-label">${label}</span>
          <span class="msg-model-badge">${m}</span>
          <span class="msg-time">${timeStr}</span>
        </div>
        <div class="msg-body"></div>
        <div class="msg-tts-bar">
          <button class="tts-play-btn" onclick="speakMessage(this)">
            <i class="ti ti-volume"></i> 読み上げ
          </button>
          <button class="tts-stop-btn" onclick="stopTTS()">
            <i class="ti ti-player-stop"></i> 停止
          </button>
          <div class="tts-progress"><div class="tts-progress-inner"></div></div>
        </div>
      </div>
    </div>`;

  msgs.appendChild(div);
  if (text) renderAIContent(div, text, false);
  return div;
}

// ─── Markdown → HTML ───
function renderAIContent(div, text, streaming) {
  const body = div.querySelector('.msg-body');
  let html = markdownToHtml(text);
  if (streaming) html += '<span class="streaming-cursor"></span>';
  body.innerHTML = html;
  // Syntax highlight code blocks
  div.querySelectorAll('pre code').forEach(el => {
    // simple keyword highlight
    el.innerHTML = syntaxHighlight(el.textContent, el.className.replace('language-',''));
  });
}

function markdownToHtml(md) {
  let html = md;

  // Code blocks
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const safeCode = escapeHtml(code.trimEnd());
    const lines = safeCode.split('\n').length;
    const langLabel = lang || 'plaintext';
    return `<div class="code-block-wrap">
      <div class="code-block-header">
        <div class="code-lang-wrap">
          <div class="code-lang-dot"></div>
          <span class="code-lang">${langLabel}</span>
        </div>
        <div class="code-header-right">
          <span class="code-lines">${lines} lines</span>
          <button class="copy-btn" onclick="copyCode(this)"><i class="ti ti-copy"></i> copy</button>
        </div>
      </div>
      <pre><code class="language-${lang}">${safeCode}</code></pre>
    </div>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Headers
  html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Bold, italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
  html = html.replace(/_(.+?)_/g, '<em>$1</em>');

  // Blockquote
  html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');

  // HR
  html = html.replace(/^---+$/gm, '<hr>');

  // Lists (unordered)
  html = html.replace(/^[\-\*] (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>[\s\S]+?<\/li>)(\n(?!<li>)|$)/g, '<ul>$1</ul>\n');

  // Lists (ordered)
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

  // Tables
  html = renderTables(html);

  // Paragraphs (not inside block elements)
  html = html.replace(/^(?!<[hupbtd]|<blockquote|<div|<hr)(.+)$/gm, '<p>$1</p>');

  // Collapse consecutive <p> tags from blank lines into spacing
  html = html.replace(/<p><\/p>/g, '');

  return html;
}

function renderTables(html) {
  return html.replace(/(\|.+\|\n)(\|[-: |]+\|\n)((?:\|.+\|\n?)*)/g, (match, header, sep, rows) => {
    const ths = header.trim().split('|').filter(Boolean).map(h => `<th>${h.trim()}</th>`).join('');
    const trs = rows.trim().split('\n').filter(Boolean).map(row => {
      const tds = row.split('|').filter(Boolean).map(d => `<td>${d.trim()}</td>`).join('');
      return `<tr>${tds}</tr>`;
    }).join('');
    return `<table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
  });
}

function syntaxHighlight(code, lang) {
  const safe = escapeHtml(code);
  if (!lang || lang === 'plaintext' || lang === 'text') return safe;

  return safe
    // コメント (最優先)
    .replace(/(\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*)/g, '<span class="tok-comment">$1</span>')
    // 文字列
    .replace(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/g, '<span class="tok-string">$1</span>')
    // キーワード
    .replace(/\b(def|class|import|from|return|if|elif|else|for|while|in|not|and|or|async|await|with|try|except|finally|raise|pass|yield|lambda|function|const|let|var|export|default|type|interface|extends|implements|public|private|protected|static|new|this|super|typeof|instanceof|void|null|undefined|true|false|None|True|False)\b/g, '<span class="tok-keyword">$1</span>')
    // 数値
    .replace(/\b(\d+\.?\d*(?:[eE][+-]?\d+)?)\b/g, '<span class="tok-number">$1</span>')
    // 関数呼び出し
    .replace(/\b([a-zA-Z_][\w]*)(?=\s*\()/g, '<span class="tok-fn">$1</span>')
    // 演算子
    .replace(/(===|!==|==|!=|<=|>=|=>|\-&gt;|\|\||&amp;&amp;)/g, '<span class="tok-op">$1</span>');
}

function copyCode(btn) {
  const code = btn.closest('.code-block-wrap').querySelector('code');
  navigator.clipboard.writeText(code.textContent).then(() => {
    btn.innerHTML = '<i class="ti ti-check"></i> copied';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.innerHTML = '<i class="ti ti-copy"></i> copy';
      btn.classList.remove('copied');
    }, 1800);
  });
}

// ═══════════════════════════════════════════
//  TTS (XAI Grok)
// ═══════════════════════════════════════════
function getPlainText(msgGroup) {
  const body = msgGroup.querySelector('.msg-body');
  return body ? body.innerText : '';
}

async function speakMessage(btn) {
  const msgGroup = btn.closest('.message-group');
  const text = getPlainText(msgGroup);
  if (!text) return;

  stopTTS();

  currentTTSBtn = btn;
  const stopBtn = msgGroup.querySelector('.tts-stop-btn');
  const progress = msgGroup.querySelector('.tts-progress');
  btn.style.display = 'none';
  stopBtn.classList.add('visible');
  progress.classList.add('active');
  document.getElementById('global-tts-bar').classList.add('visible');

  try {
    const res = await fetch(`${API}/api/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.slice(0, 15000) })
    });
    if (!res.ok) throw new Error(await res.text());
    const { audio, format } = await res.json();

    const audioBlob = b64ToBlob(audio, `audio/${format}`);
    const url = URL.createObjectURL(audioBlob);
    currentAudio = new Audio(url);
    currentAudio.play();
    currentAudio.addEventListener('ended', () => {
      URL.revokeObjectURL(url);
      resetTTSUI(msgGroup);
      document.getElementById('global-tts-bar').classList.remove('visible');
    });
  } catch(e) {
    toast('TTS エラー: ' + e.message);
    resetTTSUI(msgGroup);
    document.getElementById('global-tts-bar').classList.remove('visible');
  }
}

function stopTTS() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  document.querySelectorAll('.message-group').forEach(resetTTSUI);
  document.getElementById('global-tts-bar').classList.remove('visible');
}

function resetTTSUI(msgGroup) {
  const btn = msgGroup.querySelector('.tts-play-btn');
  const stopBtn = msgGroup.querySelector('.tts-stop-btn');
  const progress = msgGroup.querySelector('.tts-progress');
  if (btn) btn.style.display = '';
  if (stopBtn) stopBtn.classList.remove('visible');
  if (progress) progress.classList.remove('active');
}

function b64ToBlob(b64, type) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type });
}

// ═══════════════════════════════════════════
//  INPUT EVENTS
// ═══════════════════════════════════════════
const input = document.getElementById('msg-input');
const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

// PCのみEnterで送信（スマホはボタンのみ）
if (!isMobile) {
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
}
input.addEventListener('input', () => autoResize(input));

// Paste image
input.addEventListener('paste', (e) => {
  for (const item of e.clipboardData.items) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) handleImageFiles([file]);
    }
  }
});

// ═══════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════
if (isMobile) {
  const hint = document.getElementById('input-hint');
  if (hint) hint.textContent = '送信ボタンで送信 · 改行はそのまま入力';
  input.placeholder = 'メッセージを入力…';
}
// モバイルは起動時サイドバーを閉じる
if (isMobile) {
  document.getElementById('app').classList.add('sidebar-collapsed');
  document.getElementById('sidebar-overlay').classList.remove('visible');
}
loadChatList();
if (!isMobile) input.focus();
