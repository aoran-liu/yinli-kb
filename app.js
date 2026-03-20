// =============================
// 引力 App - 核心逻辑
// =============================

// ---- State ----
let state = {
  items: [],
  view: 'feed',       // 'feed' | 'action'
  intentFilter: 'all',
  search: '',
  rediscoverIdx: null,
};

const STORAGE_KEY = 'yinli_v1';

// ---- Persist ----
function saveAll() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.items)); }

function loadAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    state.items = raw ? JSON.parse(raw) : SAMPLE_ITEMS.map(x => ({ ...x }));
  } catch { state.items = SAMPLE_ITEMS.map(x => ({ ...x })); }
  if (!state.rediscoverIdx) pickRediscover();
}

// ---- Helpers ----
function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }

function relTime(ts) {
  const d = Math.floor((Date.now() - ts) / 86400000);
  if (d === 0) return '今天';
  if (d === 1) return '昨天';
  if (d < 30) return `${d} 天前`;
  return new Date(ts).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

function esc(s) {
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ---- Fake AI Engine ----
const INTENT_KEYWORDS = {
  writing:  ['写作','文章','博客','内容','draft','写','发布','文字','表达','创作'],
  decision: ['决策','选择','方案','对比','利弊','规划','策略','判断','评估'],
  learning: ['学习','理解','原理','方法','技能','掌握','入门','实践','笔记'],
  sharing:  ['分享','推荐','发给','告诉','传播','转发','社交','朋友','团队'],
};

function fakeAI(content) {
  // 1. 生成摘要：取前80字 + 省略
  const clean = content.replace(/https?:\/\/\S+/g, '[链接]').replace(/\n+/g,' ').trim();
  const summary = clean.length > 80 ? clean.slice(0, 78) + '…' : clean;

  // 2. 推荐意图：关键词匹配
  let bestIntent = 'later';
  let bestScore = 0;
  for (const [intent, kws] of Object.entries(INTENT_KEYWORDS)) {
    const score = kws.reduce((s, kw) => s + (content.includes(kw) ? 1 : 0), 0);
    if (score > bestScore) { bestScore = score; bestIntent = intent; }
  }

  // 3. 生成 Next Step 建议
  const nextMap = {
    writing:  '整理成一篇文章或段落',
    decision: '列出对比维度，做出判断',
    learning: '找一个真实场景实践一次',
    sharing:  '整理后分享给相关的人',
    later:    '等有空时再来回顾',
  };

  return { summary, intent: bestIntent, nextStep: nextMap[bestIntent] };
}

// ---- Filtered list ----
function getFiltered() {
  let list = [...state.items];
  if (state.intentFilter !== 'all') list = list.filter(i => i.intent === state.intentFilter);
  if (state.search.trim()) {
    const q = state.search.toLowerCase();
    list = list.filter(i =>
      i.title.toLowerCase().includes(q) ||
      (i.summary || '').toLowerCase().includes(q) ||
      i.content.toLowerCase().includes(q)
    );
  }
  return list.sort((a, b) => b.createdAt - a.createdAt);
}

// ---- Pick rediscover ----
function pickRediscover() {
  const processed = state.items.filter(i => i.aiProcessed);
  if (!processed.length) { state.rediscoverIdx = null; return; }
  state.rediscoverIdx = processed[Math.floor(Math.random() * processed.length)].id;
}

// ---- Render: Intent Badge ----
function intentBadge(key) {
  const cfg = INTENT_CONFIG[key] || INTENT_CONFIG.later;
  return `<span class="intent-badge" style="background:${cfg.bg};color:${cfg.color}">${cfg.emoji} ${cfg.label}</span>`;
}

// ---- Render: Feed ----
function renderFeed() {
  const items = getFiltered();
  const grid = document.getElementById('feed-grid');
  if (!items.length) {
    grid.innerHTML = `<div class="empty">
      <div class="empty-icon">${state.search ? '🔍' : '🌑'}</div>
      <div class="empty-text">${state.search ? '没有找到相关内容' : '这里还没有内容'}</div>
      <div class="empty-sub">${state.search ? '换个关键词试试' : '在上方输入框添加你的第一条知识'}</div>
    </div>`;
    return;
  }

  grid.innerHTML = items.map(item => {
    if (!item.aiProcessed) {
      return `<div class="card unprocessed" data-id="${item.id}">
        <div class="card-header">
          ${intentBadge('later')}
          <div class="card-title">${esc(item.title || item.content.slice(0, 40))}</div>
        </div>
        <div class="card-summary" style="color:var(--text-3);font-style:italic">未整理 · 点击"AI 整理"自动提取要点和推荐用途</div>
        <button class="btn-ai-process" data-id="${item.id}">✦ AI 整理</button>
      </div>`;
    }
    return `<div class="card" data-id="${item.id}">
      <div class="card-header">
        ${intentBadge(item.intent)}
        <div class="card-title">${esc(item.title)}</div>
      </div>
      ${item.summary ? `<div class="card-summary">${esc(item.summary)}</div>` : ''}
      ${item.nextStep ? `<div class="card-nextstep">${esc(item.nextStep)}</div>` : ''}
      <div class="card-footer">
        ${(item.tags||[]).map(t=>`<span class="tag">${esc(t)}</span>`).join('')}
        <span class="card-time">${relTime(item.createdAt)}</span>
        <span class="ai-badge">✦ AI整理</span>
      </div>
    </div>`;
  }).join('');

  // Events
  grid.querySelectorAll('.card').forEach(el => {
    el.addEventListener('click', e => {
      if (e.target.closest('.btn-ai-process')) return;
      openDetail(el.dataset.id);
    });
  });

  grid.querySelectorAll('.btn-ai-process').forEach(el => {
    el.addEventListener('click', e => { e.stopPropagation(); runAI(el.dataset.id); });
  });
}

// ---- Render: Action View ----
function renderAction() {
  const av = document.getElementById('action-view');

  // Rediscover
  const rdItem = state.items.find(i => i.id === state.rediscoverIdx);
  let rdHtml = '';
  if (rdItem) {
    const cfg = INTENT_CONFIG[rdItem.intent];
    rdHtml = `<div class="rediscover-card">
      <button class="btn-rediscover" id="btn-rd-refresh" title="换一条">🔀</button>
      <div class="rediscover-label">✦ 随机重逢 · ${relTime(rdItem.createdAt)}你保存了</div>
      <div class="rediscover-title">${esc(rdItem.title)}</div>
      <div class="rediscover-summary">${esc(rdItem.summary || rdItem.content.slice(0,80))}</div>
      <div class="rediscover-intent">${cfg.emoji} 当时你想用来${cfg.label}
        ${rdItem.nextStep ? `&nbsp;·&nbsp; → ${esc(rdItem.nextStep)}` : ''}
      </div>
    </div>`;
  }

  // Group by intent
  const groups = Object.keys(INTENT_CONFIG);
  let sectionsHtml = '';
  for (const key of groups) {
    const items = state.items.filter(i => i.intent === key && i.aiProcessed);
    if (!items.length) continue;
    const cfg = INTENT_CONFIG[key];
    sectionsHtml += `<div class="action-section">
      <div class="action-section-header">
        <span style="font-size:18px">${cfg.emoji}</span>
        <span class="action-section-title" style="color:${cfg.color}">${cfg.label}</span>
        <span class="action-section-count">${items.length} 条</span>
      </div>
      ${items.slice(0, 4).map(item => `
        <div class="card" data-id="${item.id}" style="margin-bottom:8px">
          <div class="card-title" style="font-size:13.5px">${esc(item.title)}</div>
          ${item.nextStep ? `<div class="card-nextstep" style="font-size:12px;margin-top:4px">${esc(item.nextStep)}</div>` : ''}
        </div>
      `).join('')}
    </div>`;
  }

  av.innerHTML = rdHtml + sectionsHtml;

  if (document.getElementById('btn-rd-refresh')) {
    document.getElementById('btn-rd-refresh').addEventListener('click', () => {
      pickRediscover(); renderAction();
    });
  }

  av.querySelectorAll('.card').forEach(el => {
    el.addEventListener('click', () => openDetail(el.dataset.id));
  });
}

// ---- Run Fake AI ----
function runAI(id) {
  const item = state.items.find(i => i.id === id);
  if (!item) return;

  // Show shimmer
  const card = document.querySelector(`.card[data-id="${id}"]`);
  if (card) {
    card.innerHTML = `<div class="ai-thinking" style="width:60%;margin-bottom:8px"></div>
      <div class="ai-thinking" style="width:90%;margin-bottom:6px"></div>
      <div class="ai-thinking" style="width:40%"></div>`;
  }

  setTimeout(() => {
    const result = fakeAI(item.content);
    if (!item.title || item.title === item.content.slice(0, 40)) {
      item.title = item.content.replace(/https?:\/\/\S+/g,'').trim().slice(0, 40) || '无标题知识';
    }
    item.summary = result.summary;
    item.intent = result.intent;
    item.nextStep = result.nextStep;
    item.aiProcessed = true;
    saveAll();
    renderFeed();
    renderSidebar();
  }, 1200);
}

// ---- Detail Panel ----
let detailId = null;

function openDetail(id) {
  const item = state.items.find(i => i.id === id);
  if (!item) return;
  detailId = id;

  const overlay = document.getElementById('overlay');
  overlay.style.display = 'flex';

  const intentsHtml = Object.entries(INTENT_CONFIG).map(([key, cfg]) => {
    const sel = key === item.intent ? 'selected' : '';
    const style = sel ? `background:${cfg.color};color:white` : '';
    return `<button class="intent-option ${sel}" data-intent="${key}" style="${style}">${cfg.emoji} ${cfg.label}</button>`;
  }).join('');

  overlay.innerHTML = `<div class="detail-panel" id="detail-panel">
    <div class="detail-header">
      <button class="btn-close" id="btn-close">✕</button>
      ${intentBadge(item.intent)}
      <span style="margin-left:auto;font-size:11px;color:var(--text-3)">${relTime(item.createdAt)}</span>
    </div>
    <div class="detail-body">
      <div class="detail-title" id="d-title">${esc(item.title)}</div>

      <div class="detail-section-label">原始内容</div>
      <div class="detail-content" id="d-content">${esc(item.content)}</div>

      ${item.aiProcessed ? `
        <div class="detail-section-label">✦ AI 摘要</div>
        <div style="font-size:13px;color:var(--text-2);line-height:1.7;margin-bottom:4px">${esc(item.summary)}</div>
      ` : `
        <button class="btn-ai-process" id="d-btn-ai" data-id="${id}" style="margin:10px 0">✦ AI 整理这条内容</button>
      `}

      <div class="detail-section-label">我要用它来…（行动意图）</div>
      <div class="detail-intent-row" id="d-intent-row">${intentsHtml}</div>

      <div class="detail-section-label">下一步</div>
      <textarea class="detail-nextstep-input" id="d-nextstep" rows="2"
        placeholder="用一句话说：拿到这条知识，我下一步要做什么？">${esc(item.nextStep || '')}</textarea>
    </div>
    <div class="detail-footer">
      <button class="btn-primary" id="d-save">保存</button>
      <button class="btn-ghost" id="d-delete">删除</button>
    </div>
  </div>`;

  // Close
  document.getElementById('btn-close').addEventListener('click', closeDetail);
  overlay.addEventListener('click', e => { if (e.target === overlay) closeDetail(); });

  // Intent select
  document.querySelectorAll('.intent-option').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.intent-option').forEach(b => {
        b.classList.remove('selected');
        b.style.background = '';
        b.style.color = '';
      });
      btn.classList.add('selected');
      const cfg = INTENT_CONFIG[btn.dataset.intent];
      btn.style.background = cfg.color;
      btn.style.color = 'white';
    });
  });

  // AI button inside detail
  const dAiBtn = document.getElementById('d-btn-ai');
  if (dAiBtn) {
    dAiBtn.addEventListener('click', () => {
      runAI(id);
      setTimeout(() => { closeDetail(); openDetail(id); }, 1500);
    });
  }

  // Save
  document.getElementById('d-save').addEventListener('click', () => {
    const selectedIntent = document.querySelector('.intent-option.selected');
    const updItem = state.items.find(i => i.id === id);
    if (!updItem) return;
    updItem.intent = selectedIntent ? selectedIntent.dataset.intent : updItem.intent;
    updItem.nextStep = document.getElementById('d-nextstep').value.trim();
    saveAll();
    closeDetail();
    renderFeed();
    renderAction();
    renderSidebar();
  });

  // Delete
  document.getElementById('d-delete').addEventListener('click', () => {
    if (!confirm('删除这条知识？')) return;
    state.items = state.items.filter(i => i.id !== id);
    saveAll();
    closeDetail();
    renderFeed();
    renderAction();
    renderSidebar();
  });
}

function closeDetail() {
  document.getElementById('overlay').style.display = 'none';
  document.getElementById('overlay').innerHTML = '';
  detailId = null;
}

// ---- Quick Add ----
function initQuickAdd() {
  const ta = document.getElementById('qa-content');
  const btnSave = document.getElementById('qa-save');

  ta.addEventListener('input', () => {
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
  });
  ta.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') doAdd();
  });
  btnSave.addEventListener('click', doAdd);

  function doAdd() {
    const content = ta.value.trim();
    if (!content) { ta.focus(); return; }
    const intent = document.getElementById('qa-intent').value;
    const nextStep = document.getElementById('qa-nextstep').value.trim();

    // Auto title: first line or first 40 chars
    const firstLine = content.split('\n')[0].replace(/https?:\/\/\S+/g,'').trim();
    const title = firstLine.slice(0, 40) || '新内容';

    const item = {
      id: genId(),
      title,
      content,
      summary: '',
      intent,
      nextStep,
      tags: [],
      createdAt: Date.now(),
      aiProcessed: false,
    };

    state.items.unshift(item);
    saveAll();
    ta.value = ''; ta.style.height = 'auto';
    document.getElementById('qa-nextstep').value = '';
    renderFeed(); renderSidebar();
  }
}

// ---- Search & Filter ----
function initSearch() {
  let timer;
  document.getElementById('search-input').addEventListener('input', e => {
    clearTimeout(timer);
    timer = setTimeout(() => { state.search = e.target.value; renderFeed(); }, 180);
  });
}

function initFilters() {
  document.getElementById('filter-bar').addEventListener('click', e => {
    const pill = e.target.closest('.filter-pill');
    if (!pill) return;
    state.intentFilter = pill.dataset.intent;
    document.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    renderFeed();
  });
}

// ---- Sidebar ----
function renderSidebar() {
  const totalBadge = document.getElementById('badge-total');
  if (totalBadge) totalBadge.textContent = state.items.length;

  const unprocessed = state.items.filter(i => !i.aiProcessed).length;
  const badge = document.getElementById('badge-unprocessed');
  if (badge) badge.style.display = unprocessed > 0 ? 'block' : 'none';
}

function initSidebar() {
  document.getElementById('nav-feed').addEventListener('click', () => switchView('feed'));
  document.getElementById('nav-action').addEventListener('click', () => switchView('action'));
}

function switchView(v) {
  state.view = v;
  document.getElementById('feed-area').style.display = v === 'feed' ? 'block' : 'none';
  document.getElementById('action-view').style.display = v === 'action' ? 'block' : 'none';
  document.getElementById('quick-add-area').style.display = v === 'feed' ? 'block' : 'none';

  document.getElementById('header-title').textContent = v === 'feed' ? '全部知识' : '行动视图';
  document.getElementById('search-input').style.display = v === 'feed' ? 'block' : 'none';

  document.getElementById('nav-feed').classList.toggle('active', v === 'feed');
  document.getElementById('nav-action').classList.toggle('active', v === 'action');

  if (v === 'action') renderAction();
  if (v === 'feed') renderFeed();
}

// ---- Init ----
function init() {
  loadAll();
  renderSidebar();
  renderFeed();
  initQuickAdd();
  initSearch();
  initFilters();
  initSidebar();
}

document.addEventListener('DOMContentLoaded', init);
