const LEGACY_STORAGE_KEY = 'vlaamFinanceData_v1';
const fmt = n => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(Number(n) || 0);
const today = () => new Date().toISOString().slice(0, 10);
const monthKey = d => (d || today()).slice(0, 7);
const normalizeText = (s = '') => String(s).normalize('NFC');
const esc = (s = '') => normalizeText(s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m]));
const parseMoneyInput = value => Number(String(value ?? '').replace(/[^0-9]/g, '')) || 0;
const formatMoneyInput = value => { const n = parseMoneyInput(value); return n ? new Intl.NumberFormat('vi-VN').format(n) : ''; };

const DEFAULT_CATEGORIES = [
  { name: 'Lương', icon: '💼', type: 'income', budget: null },
  { name: 'Thưởng', icon: '🎁', type: 'income', budget: null },
  { name: 'Thu nhập khác', icon: '💰', type: 'income', budget: null },
  { name: 'Ăn uống', icon: '🍜', type: 'expense', budget: 3000000 },
  { name: 'Di chuyển', icon: '🛵', type: 'expense', budget: 1200000 },
  { name: 'Mua sắm', icon: '🛍️', type: 'expense', budget: 2000000 },
  { name: 'Học tập', icon: '📚', type: 'expense', budget: 1500000 },
  { name: 'Giải trí', icon: '🎬', type: 'expense', budget: 1000000 }
];

const CATEGORY_ICONS = [
  '🍜','☕','🛒','🛍️','🏠','💡','🚗','⛽','🚌','✈️','🎓','📚','💊','🏥','🎬','🎮',
  '🎁','🐶','👶','💇','🏋️','📱','💻','🧾','💳','💼','💰','🏦','📈','💵','🪙','🌱'
];

function setFormError(id, message = '') {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = message;
  el.hidden = !message;
}

function bindMoneyInput(input) {
  if (!input) return;
  input.addEventListener('input', () => {
    const digits = String(input.value).replace(/[^0-9]/g, '').replace(/^0+(?=\d)/, '');
    input.value = digits ? new Intl.NumberFormat('vi-VN').format(Number(digits)) : '';
  });
  input.addEventListener('focus', () => input.select());
}

function renderCategoryIconPicker() {
  const picker = document.getElementById('categoryIconPicker');
  const hidden = document.getElementById('categoryIcon');
  if (!picker || !hidden) return;
  const selected = hidden.value || '🛍️';
  picker.innerHTML = CATEGORY_ICONS.map(icon => `<button type="button" class="icon-choice ${icon === selected ? 'selected' : ''}" data-icon="${icon}" aria-label="Chọn ${icon}" title="${icon}">${icon}</button>`).join('');
  picker.querySelectorAll('.icon-choice').forEach(btn => btn.addEventListener('click', () => {
    hidden.value = btn.dataset.icon;
    picker.querySelectorAll('.icon-choice').forEach(x => x.classList.toggle('selected', x === btn));
  }));
}


let sb = null;
let session = null;
let realtimeChannel = null;
let refreshTimer = null;
let lastSyncAt = null;
let isLoading = false;
let data = {
  autoSave: { enabled: true, amount: 1000000 },
  categories: [],
  transactions: [],
  savings: []
};

const cfg = window.VLAAM_SUPABASE || {};
const configured = Boolean(
  cfg.url && cfg.publishableKey &&
  !cfg.url.includes('PASTE_YOUR_') &&
  !cfg.publishableKey.includes('PASTE_YOUR_')
);

function showToast(msg, ms = 2200) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => t.classList.remove('show'), ms);
}

function setSyncStatus(text, state = 'pending') {
  const pill = document.getElementById('syncPill');
  const textEl = document.getElementById('syncText');
  const account = document.getElementById('accountSyncStatus');
  if (textEl) textEl.textContent = text;
  if (account) account.textContent = text;
  if (pill) {
    pill.classList.remove('online', 'offline', 'pending');
    pill.classList.add(state);
  }
}

function setOffline(isOffline) {
  const banner = document.getElementById('offlineBanner');
  if (banner) banner.hidden = !isOffline;
}

function category(id) {
  return data.categories.find(c => c.id === id) || { name: 'Đã xóa', icon: '•' };
}

function emptyRow(cols, msg) {
  return `<tr><td colspan="${cols}" style="text-align:center;color:#777;padding:24px">${msg}</td></tr>`;
}

function renderAll() {
  renderDashboard();
  renderTransactions();
  renderCategories();
  renderBudget();
  renderSavings();
  renderReports();
  populateCategorySelects();
  document.getElementById('autoSaveToggle').checked = !!data.autoSave.enabled;
  document.getElementById('autoSaveValue').textContent = fmt(data.autoSave.amount);
  updateLegacyInfo();
}

function renderDashboard() {
  const mk = monthKey(today());
  const monthTx = data.transactions.filter(t => monthKey(t.date) === mk);
  const income = monthTx.filter(t => t.type === 'income').reduce((s, t) => s + Number(t.amount), 0);
  const expense = monthTx.filter(t => t.type === 'expense').reduce((s, t) => s + Number(t.amount), 0);
  const savings = data.savings.reduce((s, g) => s + Number(g.current), 0);
  const savingsTarget = data.savings.reduce((s, g) => s + Number(g.target), 0);
  const balance = data.transactions.reduce((s, t) => s + (t.type === 'income' ? 1 : -1) * Number(t.amount), 0);

  document.getElementById('monthIncome').textContent = fmt(income);
  document.getElementById('monthExpense').textContent = fmt(expense);
  document.getElementById('totalSavings').textContent = fmt(savings);
  document.getElementById('totalBalance').textContent = fmt(balance);
  document.getElementById('savingRate').textContent = savingsTarget ? `${Math.round(savings / savingsTarget * 100)}% tổng mục tiêu` : 'Chưa có mục tiêu tiết kiệm';
  document.getElementById('chartTotal').textContent = fmt(savings);

  renderGoalList('savingGoals', data.savings.slice(0, 3), true);
  const tx = [...data.transactions].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)).slice(0, 5);
  document.getElementById('recentTransactions').innerHTML = tx.map(t => transactionRow(t)).join('') || emptyRow(5, 'Chưa có giao dịch.');
  renderSavingsChart();
}

function transactionRow(t, withAction = false) {
  const c = category(t.categoryId);
  const dateText = new Date(t.date + 'T00:00:00').toLocaleDateString('vi-VN');
  return `<tr>
    <td>${dateText}</td>
    <td>${esc(t.description)}</td>
    <td>${c.icon} ${esc(c.name)}</td>
    <td><span class="badge ${t.type}">${t.type === 'income' ? 'Thu' : 'Chi'}</span></td>
    <td class="amount ${t.type}">${t.type === 'income' ? '+' : '-'}${fmt(t.amount)}</td>
    ${withAction ? `<td><button class="mini-btn danger" onclick="deleteTransaction('${t.id}')" aria-label="Xóa giao dịch">×</button></td>` : ''}
  </tr>`;
}

function renderGoalList(id, list, allowDelete) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = list.map(g => {
    const pct = g.target > 0 ? Math.min(100, Math.round(g.current / g.target * 100)) : 0;
    return `<div class="goal-item">
      <div class="goal-main"><div class="goal-icon">${g.icon || '🌱'}</div><div><strong>${esc(g.name)}</strong><small>${g.deadline ? 'Dự kiến: ' + new Date(g.deadline + 'T00:00:00').toLocaleDateString('vi-VN') : 'Không đặt thời hạn'}</small></div></div>
      <div><div class="goal-progress-head"><span>${fmt(g.current)} / ${fmt(g.target)}</span><b>${pct}%</b></div><div class="progress"><span style="width:${pct}%"></span></div></div>
      <div class="goal-actions"><button class="mini-btn" onclick="addToSaving('${g.id}')" title="Nạp thêm">＋</button>${allowDelete ? `<button class="mini-btn danger" onclick="deleteSaving('${g.id}')" title="Xóa">×</button>` : ''}</div>
    </div>`;
  }).join('') || '<p style="color:#777">Chưa có mục tiêu tiết kiệm.</p>';
}

function renderSavingsChart() {
  const el = document.getElementById('savingsChart');
  const goals = [...data.savings].sort((a, b) => b.current - a.current).slice(0, 6);
  if (!goals.length) {
    el.innerHTML = '<div class="chart-empty">Chưa có dữ liệu tiết kiệm</div>';
    return;
  }
  const max = Math.max(...goals.map(g => Number(g.current)), 1);
  el.innerHTML = goals.map((g, i) => {
    const label = g.name.length > 8 ? `${g.name.slice(0, 7)}…` : g.name;
    const height = Math.max(6, Number(g.current) / max * 92);
    return `<div class="chart-bar" data-label="${esc(label)}" title="${esc(g.name)}: ${fmt(g.current)}" style="height:${height}%"></div>`;
  }).join('');
}

function renderTransactions() {
  const type = document.getElementById('filterType')?.value || 'all';
  const cat = document.getElementById('filterCategory')?.value || 'all';
  const m = document.getElementById('filterMonth')?.value || '';
  const q = (document.getElementById('searchInput')?.value || '').trim().toLowerCase();
  let tx = [...data.transactions].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  tx = tx.filter(t =>
    (type === 'all' || t.type === type) &&
    (cat === 'all' || t.categoryId === cat) &&
    (!m || monthKey(t.date) === m) &&
    (!q || t.description.toLowerCase().includes(q) || category(t.categoryId).name.toLowerCase().includes(q))
  );
  document.getElementById('transactionTable').innerHTML = tx.map(t => transactionRow(t, true)).join('') || emptyRow(6, 'Không tìm thấy giao dịch phù hợp.');
}

function renderCategories() {
  for (const type of ['income', 'expense']) {
    const id = type === 'income' ? 'incomeCategories' : 'expenseCategories';
    const list = data.categories.filter(c => c.type === type);
    document.getElementById(id).innerHTML = list.map(c => `<div class="category-item">
      <div class="category-name"><span>${c.icon || '•'}</span><strong>${esc(c.name)}</strong></div>
      <button class="mini-btn danger" onclick="deleteCategory('${c.id}')" title="Xóa danh mục">×</button>
    </div>`).join('') || '<p style="color:#777">Chưa có danh mục.</p>';
  }
}

function renderBudget() {
  const mk = monthKey(today());
  const expenseCats = data.categories.filter(c => c.type === 'expense');
  document.getElementById('budgetCards').innerHTML = expenseCats.map(c => {
    const spent = data.transactions.filter(t => t.type === 'expense' && t.categoryId === c.id && monthKey(t.date) === mk).reduce((s, t) => s + Number(t.amount), 0);
    const budget = Number(c.budget || 2000000);
    const pct = budget > 0 ? Math.min(100, Math.round(spent / budget * 100)) : 0;
    return `<article class="budget-card"><div class="budget-card-top"><strong>${c.icon || '•'} ${esc(c.name)}</strong><span class="badge expense">${pct}%</span></div><div class="budget-meta"><span>Đã chi ${fmt(spent)}</span><span>${fmt(budget)}</span></div><div class="progress"><span style="width:${pct}%"></span></div></article>`;
  }).join('') || '<p>Chưa có danh mục chi.</p>';
}

function renderSavings() {
  const el = document.getElementById('savingGoalsFull');
  el.innerHTML = data.savings.map(g => {
    const pct = g.target > 0 ? Math.min(100, Math.round(g.current / g.target * 100)) : 0;
    return `<article class="saving-large"><h3>${g.icon || '🌱'} ${esc(g.name)}</h3><p style="color:#777;margin:0">${g.deadline ? 'Mục tiêu đến ' + new Date(g.deadline + 'T00:00:00').toLocaleDateString('vi-VN') : 'Không đặt thời hạn'}</p><div class="numbers"><b>${fmt(g.current)}</b><span>${fmt(g.target)}</span></div><div class="progress"><span style="width:${pct}%"></span></div><div style="display:flex;justify-content:space-between;align-items:center;margin-top:13px"><strong>${pct}% hoàn thành</strong><div><button class="mini-btn" onclick="addToSaving('${g.id}')">＋</button> <button class="mini-btn danger" onclick="deleteSaving('${g.id}')">×</button></div></div></article>`;
  }).join('') || '<p>Chưa có mục tiêu tiết kiệm.</p>';
}

function renderReports() {
  const mk = monthKey(today());
  const ex = data.transactions.filter(t => t.type === 'expense' && monthKey(t.date) === mk);
  const total = ex.reduce((s, t) => s + Number(t.amount), 0);
  const byCat = {};
  ex.forEach(t => byCat[t.categoryId || 'deleted'] = (byCat[t.categoryId || 'deleted'] || 0) + Number(t.amount));
  const rows = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  document.getElementById('expenseBreakdown').innerHTML = rows.map(([id, val]) => {
    const c = category(id === 'deleted' ? null : id);
    const pct = total ? Math.round(val / total * 100) : 0;
    return `<div class="break-row"><div class="break-head"><span>${c.icon} ${esc(c.name)}</span><strong>${pct}% · ${fmt(val)}</strong></div><div class="progress"><span style="width:${pct}%"></span></div></div>`;
  }).join('') || '<p style="color:#777">Chưa có chi tiêu trong tháng.</p>';
  const income = data.transactions.filter(t => t.type === 'income' && monthKey(t.date) === mk).reduce((s, t) => s + Number(t.amount), 0);
  const net = income - total;
  document.getElementById('reportSummary').innerHTML = `<div class="summary-item"><strong>Thu nhập tháng</strong><span>${fmt(income)}</span></div><div class="summary-item"><strong>Chi tiêu tháng</strong><span>${fmt(total)}</span></div><div class="summary-item"><strong>Dòng tiền ròng</strong><span>${fmt(net)}</span></div><div class="summary-item"><strong>Tỷ lệ chi tiêu</strong><span>${income ? Math.round(total / income * 100) : 0}% thu nhập</span></div>`;
}

function populateCategorySelects() {
  const txType = document.querySelector('input[name="type"]:checked')?.value || 'expense';
  const txSel = document.getElementById('transactionCategory');
  if (txSel) {
    txSel.innerHTML = data.categories.filter(c => c.type === txType).map(c => `<option value="${c.id}">${c.icon || '•'} ${esc(c.name)}</option>`).join('');
  }
  const f = document.getElementById('filterCategory');
  if (f) {
    const cur = f.value;
    f.innerHTML = '<option value="all">Tất cả danh mục</option>' + data.categories.map(c => `<option value="${c.id}">${c.icon || '•'} ${esc(c.name)}</option>`).join('');
    if ([...f.options].some(o => o.value === cur)) f.value = cur;
  }
}

async function ensureDefaults() {
  const uid = session.user.id;
  const { data: existingCats, error: catErr } = await sb.from('categories').select('id').eq('user_id', uid).limit(1);
  if (catErr) throw catErr;
  if (!existingCats.length) {
    const rows = DEFAULT_CATEGORIES.map(c => ({ ...c, user_id: uid }));
    const { error } = await sb.from('categories').insert(rows);
    if (error) throw error;
  }

  const { data: settingRows, error: settingErr } = await sb.from('settings').select('user_id').eq('user_id', uid).limit(1);
  if (settingErr) throw settingErr;
  if (!settingRows.length) {
    const { error } = await sb.from('settings').insert({ user_id: uid, auto_save_enabled: true, auto_save_amount: 1000000 });
    if (error) throw error;
  }
}

async function loadRemoteData({ silent = false } = {}) {
  if (!session || isLoading) return;
  isLoading = true;
  if (!silent) setSyncStatus('Đang đồng bộ…', 'pending');
  try {
    const uid = session.user.id;
    const [catsRes, txRes, goalsRes, settingsRes] = await Promise.all([
      sb.from('categories').select('id,name,icon,type,budget,created_at').eq('user_id', uid).order('created_at', { ascending: true }),
      sb.from('transactions').select('id,transaction_date,description,category_id,type,amount,created_at').eq('user_id', uid).order('transaction_date', { ascending: false }).order('created_at', { ascending: false }),
      sb.from('savings_goals').select('id,name,target,current,deadline,icon,created_at').eq('user_id', uid).order('created_at', { ascending: true }),
      sb.from('settings').select('auto_save_enabled,auto_save_amount').eq('user_id', uid).maybeSingle()
    ]);
    const firstError = [catsRes.error, txRes.error, goalsRes.error, settingsRes.error].find(Boolean);
    if (firstError) throw firstError;

    data.categories = (catsRes.data || []).map(c => ({ id: c.id, name: normalizeText(c.name), icon: c.icon, type: c.type, budget: Number(c.budget || 0), createdAt: c.created_at || '' }));
    data.transactions = (txRes.data || []).map(t => ({ id: t.id, date: t.transaction_date, description: normalizeText(t.description), categoryId: t.category_id, type: t.type, amount: Number(t.amount), createdAt: t.created_at || '' }));
    data.savings = (goalsRes.data || []).map(g => ({ id: g.id, name: normalizeText(g.name), target: Number(g.target), current: Number(g.current), deadline: g.deadline || '', icon: g.icon || '🌱', createdAt: g.created_at || '' }));
    if (settingsRes.data) data.autoSave = { enabled: !!settingsRes.data.auto_save_enabled, amount: Number(settingsRes.data.auto_save_amount || 0) };

    renderAll();
    lastSyncAt = new Date();
    updateLastSyncText();
    setOffline(false);
    setSyncStatus('Đã đồng bộ', 'online');
  } catch (err) {
    console.error(err);
    setOffline(true);
    setSyncStatus('Mất kết nối', 'offline');
    if (!silent) showToast('Không thể tải dữ liệu từ cloud.');
  } finally {
    isLoading = false;
  }
}

function updateLastSyncText() {
  const el = document.getElementById('lastSyncText');
  if (!el) return;
  el.textContent = lastSyncAt ? lastSyncAt.toLocaleString('vi-VN') : '—';
}

function startRealtime() {
  stopRealtime();
  if (!session) return;
  const handleChange = () => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => loadRemoteData({ silent: true }), 350);
  };
  realtimeChannel = sb.channel(`vlaam-finance-${session.user.id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, handleChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'categories' }, handleChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'savings_goals' }, handleChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'settings' }, handleChange)
    .subscribe(status => {
      if (status === 'SUBSCRIBED') setSyncStatus('Đã đồng bộ', 'online');
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') setSyncStatus('Đồng bộ chậm', 'pending');
    });
}

function stopRealtime() {
  if (realtimeChannel && sb) sb.removeChannel(realtimeChannel);
  realtimeChannel = null;
}

async function handleSession(nextSession) {
  session = nextSession;
  if (!session) {
    stopRealtime();
    document.getElementById('appShell').classList.add('app-hidden');
    document.getElementById('authGate').classList.remove('auth-hidden');
    return;
  }

  document.getElementById('authGate').classList.add('auth-hidden');
  document.getElementById('appShell').classList.remove('app-hidden');
  document.getElementById('userEmail').textContent = session.user.email || 'Tài khoản';
  document.getElementById('accountEmail').textContent = session.user.email || 'Tài khoản';

  try {
    await ensureDefaults();
    await loadRemoteData();
    startRealtime();
    maybeOfferLegacyImport();
  } catch (err) {
    console.error(err);
    setSyncStatus('Lỗi cấu hình', 'offline');
    showToast('Không thể khởi tạo dữ liệu. Kiểm tra SQL/RLS trong Supabase.', 4000);
  }
}

function switchAuthTab(mode) {
  const login = mode === 'login';
  document.getElementById('loginTab').classList.toggle('active', login);
  document.getElementById('signupTab').classList.toggle('active', !login);
  document.getElementById('loginForm').hidden = !login;
  document.getElementById('signupForm').hidden = login;
}

async function login(email, password) {
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

async function signup(email, password) {
  const { data: result, error } = await sb.auth.signUp({ email, password });
  if (error) throw error;
  if (!result.session) {
    alert('Tài khoản đã được tạo. Hãy mở email để xác nhận tài khoản, sau đó quay lại đăng nhập.');
    switchAuthTab('login');
  }
}

window.deleteTransaction = async id => {
  if (!confirm('Xóa giao dịch này?')) return;
  const { error } = await sb.from('transactions').delete().eq('id', id);
  if (error) return showToast(`Không xóa được: ${error.message}`, 3500);
  data.transactions = data.transactions.filter(t => t.id !== id);
  renderAll();
  showToast('Đã xóa giao dịch');
};

window.deleteCategory = async id => {
  const usedCount = data.transactions.filter(t => t.categoryId === id).length;
  if (usedCount > 0) {
    alert(`Danh mục này đang được dùng bởi ${usedCount} giao dịch. Để tránh mất liên kết dữ liệu, hãy chuyển các giao dịch sang danh mục khác trước khi xóa.`);
    return;
  }
  if (!confirm('Xóa danh mục này?')) return;
  const { error } = await sb.from('categories').delete().eq('id', id);
  if (error) return showToast(`Không xóa được: ${error.message}`, 3500);
  data.categories = data.categories.filter(c => c.id !== id);
  renderAll();
  showToast('Đã xóa danh mục');
};

window.deleteSaving = async id => {
  if (!confirm('Xóa mục tiêu tiết kiệm này?')) return;
  const { error } = await sb.from('savings_goals').delete().eq('id', id);
  if (error) return showToast(`Không xóa được: ${error.message}`, 3500);
  data.savings = data.savings.filter(s => s.id !== id);
  renderAll();
  showToast('Đã xóa mục tiêu');
};

window.addToSaving = async id => {
  const g = data.savings.find(s => s.id === id);
  if (!g) return;
  const raw = prompt(`Nạp thêm vào “${g.name}” (VNĐ):`, '500000');
  if (raw === null) return;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return alert('Số tiền không hợp lệ.');
  const next = Math.min(g.target, g.current + n);
  const { error } = await sb.from('savings_goals').update({ current: next }).eq('id', id);
  if (error) return showToast(`Không cập nhật được: ${error.message}`, 3500);
  g.current = next;
  renderAll();
  showToast('Đã cập nhật tiết kiệm');
};

function showSection(id) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active-section'));
  document.getElementById(id).classList.add('active-section');
  document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.section === id));
  document.getElementById('sidebar').classList.remove('open');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openModal(id) {
  document.getElementById(id).classList.add('open');
  if (id === 'transactionModal') {
    document.getElementById('transactionDate').value = today();
    setFormError('transactionError');
  }
  if (id === 'categoryModal') {
    setFormError('categoryError');
    if (!document.getElementById('categoryIcon').value) document.getElementById('categoryIcon').value = '🛍️';
    renderCategoryIconPicker();
  }
  if (id === 'savingModal') setFormError('savingError');
}

function getLegacyData() {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function updateLegacyInfo() {
  const el = document.getElementById('legacyInfo');
  if (!el) return;
  const legacy = getLegacyData();
  if (!legacy) {
    el.textContent = 'Không phát hiện dữ liệu v1 trên thiết bị này.';
    return;
  }
  const txCount = Array.isArray(legacy.transactions) ? legacy.transactions.length : 0;
  const savingCount = Array.isArray(legacy.savings) ? legacy.savings.length : 0;
  el.textContent = `Phát hiện ${txCount} giao dịch và ${savingCount} mục tiêu tiết kiệm trong dữ liệu v1.`;
}

function maybeOfferLegacyImport() {
  const legacy = getLegacyData();
  if (!legacy || !session) return;
  const key = `vlaamLegacyPrompted:${session.user.id}`;
  if (sessionStorage.getItem(key)) return;
  sessionStorage.setItem(key, '1');
  if (!data.transactions.length && !data.savings.length) {
    setTimeout(() => {
      if (confirm('Phát hiện dữ liệu từ bản v1 trên thiết bị này. Bạn có muốn nhập dữ liệu đó lên cloud để dùng trên mọi thiết bị không?')) importLegacyData();
    }, 700);
  }
}

async function importLegacyData() {
  const legacy = getLegacyData();
  if (!legacy) return alert('Không tìm thấy dữ liệu v1 trên thiết bị này.');
  if (data.transactions.length || data.savings.length) {
    return alert('Tài khoản cloud đã có giao dịch hoặc mục tiêu tiết kiệm. Để tránh nhập trùng, chức năng này chỉ chạy khi cloud chưa có dữ liệu chính.');
  }
  if (!confirm('Nhập dữ liệu v1 lên cloud? Dữ liệu v1 trên thiết bị sẽ vẫn được giữ lại.')) return;

  setSyncStatus('Đang nhập dữ liệu…', 'pending');
  try {
    const uid = session.user.id;
    const mapping = {};
    const oldCats = Array.isArray(legacy.categories) ? legacy.categories : [];

    for (const old of oldCats) {
      let existing = data.categories.find(c => c.type === old.type && c.name.trim().toLowerCase() === String(old.name || '').trim().toLowerCase());
      if (!existing) {
        const { data: inserted, error } = await sb.from('categories').insert({
          user_id: uid,
          name: String(old.name || 'Danh mục').slice(0, 30),
          icon: String(old.icon || '•').slice(0, 8),
          type: old.type === 'income' ? 'income' : 'expense',
          budget: old.type === 'expense' ? Number(old.budget || 2000000) : null
        }).select('id,name,icon,type,budget,created_at').single();
        if (error) throw error;
        existing = { id: inserted.id, name: inserted.name, icon: inserted.icon, type: inserted.type, budget: Number(inserted.budget || 0), createdAt: inserted.created_at || '' };
        data.categories.push(existing);
      }
      mapping[old.id] = existing.id;
    }

    const txRows = (Array.isArray(legacy.transactions) ? legacy.transactions : []).map(t => ({
      user_id: uid,
      transaction_date: t.date || today(),
      description: String(t.description || 'Giao dịch').slice(0, 120),
      category_id: mapping[t.categoryId] || null,
      type: t.type === 'income' ? 'income' : 'expense',
      amount: Number(t.amount || 0)
    })).filter(t => t.amount > 0);
    if (txRows.length) {
      const { error } = await sb.from('transactions').insert(txRows);
      if (error) throw error;
    }

    const goalRows = (Array.isArray(legacy.savings) ? legacy.savings : []).map(g => ({
      user_id: uid,
      name: String(g.name || 'Mục tiêu').slice(0, 80),
      target: Number(g.target || 0),
      current: Math.max(0, Number(g.current || 0)),
      deadline: g.deadline || null,
      icon: String(g.icon || '🌱').slice(0, 8)
    })).filter(g => g.target > 0);
    if (goalRows.length) {
      const { error } = await sb.from('savings_goals').insert(goalRows);
      if (error) throw error;
    }

    if (legacy.autoSave) {
      const { error } = await sb.from('settings').update({
        auto_save_enabled: !!legacy.autoSave.enabled,
        auto_save_amount: Math.max(0, Number(legacy.autoSave.amount || 0))
      }).eq('user_id', uid);
      if (error) throw error;
    }

    localStorage.setItem(`vlaamLegacyImported:${uid}`, new Date().toISOString());
    await loadRemoteData();
    showToast('Đã nhập dữ liệu v1 lên cloud');
  } catch (err) {
    console.error(err);
    showToast(`Nhập dữ liệu thất bại: ${err.message}`, 4500);
  }
}

function bindUI() {
  document.getElementById('loginTab').addEventListener('click', () => switchAuthTab('login'));
  document.getElementById('signupTab').addEventListener('click', () => switchAuthTab('signup'));

  document.getElementById('loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      e.submitter.disabled = true;
      await login(document.getElementById('loginEmail').value.trim(), document.getElementById('loginPassword').value);
    } catch (err) {
      alert(`Đăng nhập không thành công: ${err.message}`);
    } finally {
      e.submitter.disabled = false;
    }
  });

  document.getElementById('signupForm').addEventListener('submit', async e => {
    e.preventDefault();
    const pass = document.getElementById('signupPassword').value;
    const pass2 = document.getElementById('signupPassword2').value;
    if (pass !== pass2) return alert('Hai mật khẩu chưa trùng nhau.');
    try {
      e.submitter.disabled = true;
      await signup(document.getElementById('signupEmail').value.trim(), pass);
    } catch (err) {
      alert(`Không tạo được tài khoản: ${err.message}`);
    } finally {
      e.submitter.disabled = false;
    }
  });

  document.querySelectorAll('.nav-item').forEach(btn => btn.addEventListener('click', () => showSection(btn.dataset.section)));
  document.querySelectorAll('[data-section-jump]').forEach(btn => btn.addEventListener('click', () => showSection(btn.dataset.sectionJump)));
  document.getElementById('mobileMenu').addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));

  document.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => openModal(b.dataset.open)));
  document.querySelectorAll('.close-modal').forEach(b => b.addEventListener('click', () => b.closest('.modal').classList.remove('open')));
  document.querySelectorAll('.modal').forEach(m => m.addEventListener('click', e => { if (e.target === m) m.classList.remove('open'); }));

  ['transactionAmount', 'savingTarget', 'savingCurrent'].forEach(id => bindMoneyInput(document.getElementById(id)));
  renderCategoryIconPicker();

  document.querySelectorAll('input[name="type"]').forEach(r => r.addEventListener('change', populateCategorySelects));

  document.getElementById('transactionForm').addEventListener('submit', async e => {
    e.preventDefault();
    setFormError('transactionError');
    const type = document.querySelector('input[name="type"]:checked').value;
    const amount = parseMoneyInput(document.getElementById('transactionAmount').value);
    const description = normalizeText(document.getElementById('transactionDescription').value.trim());
    const categoryId = document.getElementById('transactionCategory').value || null;
    const transactionDate = document.getElementById('transactionDate').value;

    if (!amount || amount <= 0) return setFormError('transactionError', 'Vui lòng nhập số tiền lớn hơn 0.');
    if (!description) return setFormError('transactionError', 'Vui lòng nhập nội dung giao dịch.');
    if (!categoryId) return setFormError('transactionError', 'Chưa có danh mục phù hợp. Hãy tạo danh mục trước.');
    if (!transactionDate) return setFormError('transactionError', 'Vui lòng chọn ngày giao dịch.');

    const payload = {
      user_id: session.user.id,
      type,
      amount,
      description,
      category_id: categoryId,
      transaction_date: transactionDate
    };
    e.submitter.disabled = true;
    const { error } = await sb.from('transactions').insert(payload);
    e.submitter.disabled = false;
    if (error) return setFormError('transactionError', `Không lưu được giao dịch: ${error.message}`);
    e.target.reset();
    document.querySelector('input[name="type"][value="expense"]').checked = true;
    document.getElementById('transactionDate').value = today();
    populateCategorySelects();
    document.getElementById('transactionModal').classList.remove('open');
    await loadRemoteData({ silent: true });
    showToast('Đã thêm giao dịch');
  });

  document.getElementById('categoryForm').addEventListener('submit', async e => {
    e.preventDefault();
    setFormError('categoryError');
    const name = normalizeText(document.getElementById('categoryName').value.trim());
    const type = document.getElementById('categoryType').value;
    const icon = document.getElementById('categoryIcon').value || '🛍️';
    if (!name) return setFormError('categoryError', 'Vui lòng nhập tên danh mục.');
    if (data.categories.some(c => normalizeText(c.name).toLocaleLowerCase('vi') === name.toLocaleLowerCase('vi') && c.type === type)) return setFormError('categoryError', 'Danh mục này đã tồn tại.');
    const payload = {
      user_id: session.user.id,
      name,
      icon,
      type,
      budget: type === 'expense' ? 2000000 : null
    };
    e.submitter.disabled = true;
    const { error } = await sb.from('categories').insert(payload);
    e.submitter.disabled = false;
    if (error) return setFormError('categoryError', `Không thêm được danh mục: ${error.message}`);
    e.target.reset();
    document.getElementById('categoryIcon').value = '🛍️';
    renderCategoryIconPicker();
    document.getElementById('categoryModal').classList.remove('open');
    await loadRemoteData({ silent: true });
    showToast('Đã thêm danh mục');
  });

  document.getElementById('savingForm').addEventListener('submit', async e => {
    e.preventDefault();
    setFormError('savingError');
    const name = normalizeText(document.getElementById('savingName').value.trim());
    const target = parseMoneyInput(document.getElementById('savingTarget').value);
    const current = parseMoneyInput(document.getElementById('savingCurrent').value);
    if (!name) return setFormError('savingError', 'Vui lòng nhập tên mục tiêu.');
    if (!target || target <= 0) return setFormError('savingError', 'Số tiền mục tiêu phải lớn hơn 0.');
    if (current > target) return setFormError('savingError', 'Số tiền đã tiết kiệm không thể lớn hơn số tiền mục tiêu.');
    const payload = {
      user_id: session.user.id,
      name,
      target,
      current,
      deadline: document.getElementById('savingDeadline').value || null,
      icon: '🌱'
    };
    e.submitter.disabled = true;
    const { error } = await sb.from('savings_goals').insert(payload);
    e.submitter.disabled = false;
    if (error) return setFormError('savingError', `Không tạo được mục tiêu: ${error.message}`);
    e.target.reset();
    document.getElementById('savingCurrent').value = '0';
    document.getElementById('savingModal').classList.remove('open');
    await loadRemoteData({ silent: true });
    showToast('Đã tạo mục tiêu tiết kiệm');
  });

  document.getElementById('filterType').addEventListener('change', renderTransactions);
  document.getElementById('filterCategory').addEventListener('change', renderTransactions);
  document.getElementById('filterMonth').addEventListener('change', renderTransactions);
  document.getElementById('searchInput').addEventListener('input', renderTransactions);
  document.getElementById('clearFilters').addEventListener('click', () => {
    document.getElementById('filterType').value = 'all';
    document.getElementById('filterCategory').value = 'all';
    document.getElementById('filterMonth').value = '';
    document.getElementById('searchInput').value = '';
    renderTransactions();
  });

  document.getElementById('autoSaveToggle').addEventListener('change', async e => {
    const next = e.target.checked;
    const { error } = await sb.from('settings').update({ auto_save_enabled: next }).eq('user_id', session.user.id);
    if (error) {
      e.target.checked = !next;
      return showToast(`Không cập nhật được: ${error.message}`, 3500);
    }
    data.autoSave.enabled = next;
    showToast(next ? 'Đã bật kế hoạch tiết kiệm định kỳ' : 'Đã tắt kế hoạch tiết kiệm định kỳ');
  });

  document.getElementById('editAutoSave').addEventListener('click', async () => {
    const raw = prompt('Số tiền tự động tiết kiệm mỗi tháng (VNĐ):', data.autoSave.amount);
    if (raw === null) return;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return alert('Số tiền không hợp lệ.');
    const { error } = await sb.from('settings').update({ auto_save_amount: n }).eq('user_id', session.user.id);
    if (error) return showToast(`Không cập nhật được: ${error.message}`, 3500);
    data.autoSave.amount = n;
    renderAll();
    showToast('Đã cập nhật mức tiết kiệm');
  });

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await sb.auth.signOut();
    showToast('Đã đăng xuất');
  });
  document.getElementById('manualSyncBtn').addEventListener('click', () => loadRemoteData());
  document.getElementById('legacyImportBtn').addEventListener('click', importLegacyData);

  window.addEventListener('online', () => loadRemoteData({ silent: true }));
  window.addEventListener('offline', () => { setOffline(true); setSyncStatus('Ngoại tuyến', 'offline'); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && session) loadRemoteData({ silent: true }); });
}

async function init() {
  bindUI();
  renderAll();
  updateLegacyInfo();

  if (!configured) {
    document.getElementById('setupWarning').hidden = false;
    document.querySelectorAll('#authForms input, #authForms button').forEach(el => el.disabled = true);
    return;
  }

  sb = window.supabase.createClient(cfg.url, cfg.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });

  const { data: { session: existingSession } } = await sb.auth.getSession();
  await handleSession(existingSession);

  sb.auth.onAuthStateChange((_event, nextSession) => {
    setTimeout(() => handleSession(nextSession), 0);
  });
}

init();
