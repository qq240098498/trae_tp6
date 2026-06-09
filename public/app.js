const API = '/api';
let currentPage = 'dashboard';
let categoriesCache = [];
let moviesCache = [];

async function request(url, options = {}) {
  try {
    const res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
      body: options.body ? JSON.stringify(options.body) : undefined
    });
    const data = await res.json();
    if (!data.success) {
      showToast(data.message || '请求失败', 'error');
      return null;
    }
    return data.data;
  } catch (e) {
    showToast('网络错误: ' + e.message, 'error');
    return null;
  }
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  const icons = { success: '✅', error: '❌', info: 'ℹ️', warning: '⚠️' };
  toast.innerHTML = `<span>${icons[type]}</span><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'modalIn 0.2s reverse';
    setTimeout(() => toast.remove(), 200);
  }, 3000);
}

function showModal(content, title = '', isLarge = false) {
  const container = document.getElementById('modalContainer');
  container.innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this)closeModal()">
      <div class="modal ${isLarge ? 'modal-lg' : ''}">
        ${title ? `<div class="modal-header">
          <h3>${title}</h3>
          <button class="modal-close" onclick="closeModal()">✕</button>
        </div>` : ''}
        <div class="modal-body">${content}</div>
      </div>
    </div>
  `;
}

function closeModal() {
  document.getElementById('modalContainer').innerHTML = '';
}

function modalFooter(actions) {
  return `<div class="modal-footer">${actions.map(a => 
    `<button class="btn ${a.class || 'btn-outline'}" onclick="${a.onclick}">${a.text}</button>`
  ).join('')}</div>`;
}

function statusText(status) {
  const map = {
    idle: '空闲中', occupied: '使用中', maintenance: '维护中',
    booked: '已预约', checked_in: '已入场', completed: '已完成', cancelled: '已取消'
  };
  return map[status] || status;
}

function fmtDT(s) {
  if (!s) return '-';
  const d = new Date(s);
  return d.toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function fmtDate(s) {
  if (!s) return '-';
  const d = new Date(s);
  return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

function fmtTime(s) {
  if (!s) return '-';
  const d = new Date(s);
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function fmtMoney(n) {
  return '¥' + (Number(n) || 0).toFixed(2);
}

function updateTime() {
  const el = document.getElementById('currentTime');
  if (el) {
    el.textContent = new Date().toLocaleString('zh-CN', { hour12: false });
  }
}

function setActivePage(page, title) {
  currentPage = page;
  document.querySelectorAll('.menu-item').forEach(el => {
    el.classList.toggle('active', el.dataset.page === page);
  });
  document.getElementById('pageTitle').textContent = title;
}

document.querySelectorAll('.menu-item').forEach(el => {
  el.addEventListener('click', () => {
    const page = el.dataset.page;
    renderPage(page);
  });
});

document.getElementById('quickBookBtn').addEventListener('click', showBookingModal);

// ==================== 仪表盘 ====================

async function renderDashboard() {
  setActivePage('dashboard', '运营总览');
  const data = await request(`${API}/stats/dashboard`);
  if (!data) return;

  const roomMap = {};
  data.room_stats.forEach(r => roomMap[r.status] = r.count);
  const totalRooms = (roomMap.idle || 0) + (roomMap.occupied || 0) + (roomMap.maintenance || 0);

  const upcomingHtml = data.upcoming_reservations.length ? 
    data.upcoming_reservations.map(r => `
      <div class="upcoming-item">
        <div class="upcoming-time">${fmtTime(r.start_time)}</div>
        <div class="upcoming-info">
          <strong>${r.customer_name} · ${r.room_name}</strong>
          <small>${r.movie_title || '未选片'} · ${fmtDT(r.start_time)} - ${fmtTime(r.end_time)}</small>
        </div>
        <button class="btn btn-sm btn-success" onclick="quickCheckin(${r.id})">核验入场</button>
      </div>
    `).join('') : '<div class="empty-state"><div class="empty-state-icon">📅</div>暂无即将开始的预约</div>';

  document.getElementById('pageContent').innerHTML = `
    <div class="stats-grid">
      <div class="stat-card blue">
        <div class="stat-label">包间总数</div>
        <div class="stat-value">${totalRooms}<span class="stat-unit">间</span></div>
        <div class="stat-icon">🏠</div>
      </div>
      <div class="stat-card green">
        <div class="stat-label">空闲包间</div>
        <div class="stat-value">${roomMap.idle || 0}<span class="stat-unit">间</span></div>
        <div class="stat-icon">✅</div>
      </div>
      <div class="stat-card red">
        <div class="stat-label">使用中</div>
        <div class="stat-value">${roomMap.occupied || 0}<span class="stat-unit">间</span></div>
        <div class="stat-icon">🔴</div>
      </div>
      <div class="stat-card purple">
        <div class="stat-label">今日预约</div>
        <div class="stat-value">${data.today_reservations.total || 0}<span class="stat-unit">单</span></div>
        <div class="stat-icon">📋</div>
      </div>
      <div class="stat-card orange">
        <div class="stat-label">今日营收</div>
        <div class="stat-value" style="color:#f59e0b">${fmtMoney(data.today_revenue)}</div>
        <div class="stat-icon">💰</div>
      </div>
    </div>

    <div class="two-col">
      <div class="card">
        <div class="card-header"><h3>📅 今日预约统计</h3></div>
        <div class="card-body">
          <div class="stats-grid" style="margin-bottom:0;grid-template-columns:repeat(4,1fr)">
            <div class="stat-card blue" style="padding:16px">
              <div class="stat-label">待入场</div>
              <div class="stat-value" style="font-size:24px">${data.today_reservations.booked || 0}</div>
            </div>
            <div class="stat-card green" style="padding:16px">
              <div class="stat-label">观影中</div>
              <div class="stat-value" style="font-size:24px">${data.today_reservations.checked_in || 0}</div>
            </div>
            <div class="stat-card purple" style="padding:16px">
              <div class="stat-label">已完成</div>
              <div class="stat-value" style="font-size:24px">${data.today_reservations.completed || 0}</div>
            </div>
            <div class="stat-card" style="padding:16px">
              <div class="stat-label">已取消</div>
              <div class="stat-value" style="font-size:24px">${data.today_reservations.cancelled || 0}</div>
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header"><h3>⏰ 即将开始</h3></div>
        <div class="card-body" style="max-height:300px;overflow-y:auto">
          <div class="upcoming-list">${upcomingHtml}</div>
        </div>
      </div>
    </div>
  `;
}

async function quickCheckin(id) {
  const result = await request(`${API}/checkin`, {
    method: 'POST',
    body: { reservation_id: id }
  });
  if (result) {
    showToast('核验成功！欢迎光临', 'success');
    renderDashboard();
  }
}

// ==================== 包间状态 ====================

async function renderRooms() {
  setActivePage('rooms', '包间状态');
  const rooms = await request(`${API}/rooms`);
  if (!rooms) return;

  document.getElementById('pageContent').innerHTML = `
    <div class="filter-bar">
      <div class="category-tabs">
        <div class="category-tab active" onclick="filterRooms('all', this)">全部 (${rooms.length})</div>
        <div class="category-tab" onclick="filterRooms('idle', this)">空闲 (${rooms.filter(r=>r.status==='idle').length})</div>
        <div class="category-tab" onclick="filterRooms('occupied', this)">使用中 (${rooms.filter(r=>r.status==='occupied').length})</div>
        <div class="category-tab" onclick="filterRooms('maintenance', this)">维护中 (${rooms.filter(r=>r.status==='maintenance').length})</div>
      </div>
    </div>
    <div class="rooms-grid" id="roomsGrid">
      ${rooms.map(renderRoomCard).join('')}
    </div>
  `;
}

function renderRoomCard(r) {
  const resv = r.active_reservation;
  const resvHtml = resv ? `
    <div class="active-resv">
      <div class="active-resv-row">
        <span class="active-resv-label">顾客:</span>
        <span><strong>${resv.customer_name}</strong> ${resv.customer_phone}</span>
      </div>
      <div class="active-resv-row">
        <span class="active-resv-label">时间:</span>
        <span>${fmtTime(resv.start_time)} - ${fmtTime(resv.end_time)}</span>
      </div>
      ${resv.movie_title ? `<div class="active-resv-row"><span class="active-resv-label">影片:</span><span>${resv.movie_title}</span></div>` : ''}
    </div>
  ` : '';

  return `
    <div class="room-card status-${r.status}" onclick="showRoomDetail(${r.id})">
      <div class="room-header">
        <div class="room-name">${r.name}</div>
        <div class="room-status ${r.status}">${statusText(r.status)}</div>
      </div>
      <div class="room-type">${r.type}</div>
      <div class="room-info">
        <span>👥 ${r.capacity}人</span>
        <span>📺 高清投影</span>
        <span>🛋️ 舒适沙发</span>
      </div>
      <div class="room-price">${fmtMoney(r.price_per_hour)}<small>/小时</small></div>
      ${resvHtml}
      <div class="room-actions">
        ${r.status === 'idle' ? `
          <button class="btn btn-sm btn-primary" onclick="event.stopPropagation();showBookingModal(${r.id})">预约</button>
        ` : r.status === 'occupied' ? `
          <button class="btn btn-sm btn-danger" onclick="event.stopPropagation();showCheckoutModal(${r.id})">结算退房</button>
        ` : ''}
      </div>
    </div>
  `;
}

async function filterRooms(status, el) {
  document.querySelectorAll('.category-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  const rooms = await request(status === 'all' ? `${API}/rooms` : `${API}/rooms?status=${status}`);
  if (rooms) {
    document.getElementById('roomsGrid').innerHTML = rooms.map(renderRoomCard).join('');
  }
}

async function showRoomDetail(id) {
  const room = await request(`${API}/rooms/${id}`);
  if (!room) return;

  const resvHtml = room.reservations && room.reservations.length ?
    `<table class="data-table"><thead><tr>
      <th>顾客</th><th>电话</th><th>时段</th><th>影片</th><th>状态</th>
    </tr></thead><tbody>
    ${room.reservations.map(r => `<tr>
      <td><strong>${r.customer_name}</strong></td>
      <td>${r.customer_phone}</td>
      <td>${fmtDT(r.start_time)}<br>~ ${fmtTime(r.end_time)}</td>
      <td>${r.movie_title || '-'}</td>
      <td><span class="badge badge-${r.status}">${statusText(r.status)}</span></td>
    </tr>`).join('')}
    </tbody></table>` :
    '<div class="empty-state"><div class="empty-state-icon">📭</div>暂无预约记录</div>';

  showModal(`
    <div class="form-row">
      <div>
        <div class="stat-card" style="box-shadow:none;border:1px solid var(--border)">
          <div class="stat-label">包间名称</div>
          <div class="stat-value" style="font-size:24px">${room.name}</div>
        </div>
      </div>
      <div>
        <div class="stat-card" style="box-shadow:none;border:1px solid var(--border)">
          <div class="stat-label">当前状态</div>
          <div class="stat-value" style="font-size:20px;color:${room.status==='idle'?'var(--success)':'var(--danger)'}">${statusText(room.status)}</div>
        </div>
      </div>
    </div>
    <div class="form-row" style="margin-top:16px">
      <div class="form-group"><div class="form-label">包间类型</div><div>${room.type}</div></div>
      <div class="form-group"><div class="form-label">容纳人数</div><div>${room.capacity} 人</div></div>
      <div class="form-group"><div class="form-label">小时单价</div><div style="color:var(--primary);font-weight:700">${fmtMoney(room.price_per_hour)}</div></div>
    </div>
    <div class="card-header" style="padding:14px 0;border:none;border-top:1px solid var(--border);margin-top:8px">
      <h3>📅 预约排期</h3>
    </div>
    ${resvHtml}
  `, `包间详情 - ${room.name}`, true);
}

// ==================== 影片库 ====================

let currentCategory = 'all';
let movieKeyword = '';

async function renderMovies() {
  setActivePage('movies', '影片库');
  categoriesCache = await request(`${API}/categories`) || [];
  await renderMovieList();
}

async function renderMovieList() {
  let url = `${API}/movies`;
  const params = [];
  if (currentCategory !== 'all') params.push(`category_id=${currentCategory}`);
  if (movieKeyword) params.push(`keyword=${encodeURIComponent(movieKeyword)}`);
  if (params.length) url += '?' + params.join('&');
  
  moviesCache = await request(url) || [];

  const categoryHtml = `
    <div class="category-tabs">
      <div class="category-tab ${currentCategory==='all'?'active':''}" onclick="setCategory('all')">全部</div>
      ${categoriesCache.map(c => `
        <div class="category-tab ${currentCategory==c.id?'active':''}" onclick="setCategory(${c.id})">
          ${c.name} (${c.movie_count || 0})
        </div>
      `).join('')}
    </div>
  `;

  const moviesHtml = moviesCache.length ?
    `<div class="movies-grid">${moviesCache.map(m => `
      <div class="movie-card">
        <div class="movie-poster">
          🎬
          <div class="movie-rating">⭐ ${m.rating.toFixed(1)}</div>
        </div>
        <div class="movie-info">
          <div class="movie-title" title="${m.title}">${m.title}</div>
          <div class="movie-meta">
            <span>⏱️ ${m.duration}分钟</span>
            <span>${m.release_year || ''}</span>
          </div>
          <span class="movie-category">${m.category_name || '未分类'}</span>
        </div>
      </div>
    `).join('')}</div>` :
    '<div class="empty-state"><div class="empty-state-icon">🎞️</div>暂无影片</div>';

  document.getElementById('pageContent').innerHTML = `
    <div class="filter-bar">
      ${categoryHtml}
    </div>
    <div class="filter-bar">
      <div class="form-group" style="flex:1;max-width:360px;margin-bottom:0">
        <input class="form-input" placeholder="🔍 搜索影片名称或描述..." 
               value="${movieKeyword}" oninput="onMovieSearch(this.value)">
      </div>
      <button class="btn btn-primary" onclick="showAddMovieModal()">➕ 添加影片</button>
    </div>
    <div id="movieList">${moviesHtml}</div>
  `;
}

function setCategory(id) {
  currentCategory = id;
  renderMovieList();
}

function onMovieSearch(val) {
  movieKeyword = val;
  clearTimeout(window._searchTimer);
  window._searchTimer = setTimeout(renderMovieList, 300);
}

function showAddMovieModal() {
  showModal(`
    <div class="form-group">
      <label class="form-label">影片名称 *</label>
      <input class="form-input" id="m_title" placeholder="输入影片名称">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">分类</label>
        <select class="form-select" id="m_category">
          <option value="">未分类</option>
          ${categoriesCache.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">时长(分钟) *</label>
        <input class="form-input" id="m_duration" type="number" min="1" placeholder="120">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">评分</label>
        <input class="form-input" id="m_rating" type="number" step="0.1" min="0" max="10" placeholder="8.5">
      </div>
      <div class="form-group">
        <label class="form-label">上映年份</label>
        <input class="form-input" id="m_year" type="number" min="1900" max="2100" placeholder="2024">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">简介</label>
      <textarea class="form-textarea" id="m_desc" placeholder="影片简介..."></textarea>
    </div>
    ${modalFooter([
      { text: '取消', onclick: 'closeModal()' },
      { text: '添加影片', class: 'btn-primary', onclick: 'submitAddMovie()' }
    ])}
  `, '添加影片');
}

async function submitAddMovie() {
  const data = {
    title: document.getElementById('m_title').value.trim(),
    category_id: document.getElementById('m_category').value || null,
    duration: parseInt(document.getElementById('m_duration').value),
    rating: parseFloat(document.getElementById('m_rating').value) || 0,
    release_year: parseInt(document.getElementById('m_year').value) || null,
    description: document.getElementById('m_desc').value.trim()
  };
  if (!data.title || !data.duration) {
    showToast('请填写名称和时长', 'warning');
    return;
  }
  const result = await request(`${API}/movies`, { method: 'POST', body: data });
  if (result) {
    showToast('影片添加成功', 'success');
    closeModal();
    renderMovieList();
  }
}

// ==================== 预约排期 ====================

let resvFilter = { status: '', date: '' };

async function renderReservations() {
  setActivePage('reservations', '预约排期');
  await renderResvList();
}

async function renderResvList() {
  let url = `${API}/reservations`;
  const params = [];
  if (resvFilter.status) params.push(`status=${resvFilter.status}`);
  if (resvFilter.date) params.push(`date=${resvFilter.date}`);
  if (params.length) url += '?' + params.join('&');

  const list = await request(url);
  if (!list) return;

  document.getElementById('pageContent').innerHTML = `
    <div class="filter-bar">
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">状态筛选</label>
        <select class="form-select" onchange="resvFilter.status=this.value;renderResvList()">
          <option value="">全部状态</option>
          <option value="booked">已预约</option>
          <option value="checked_in">已入场</option>
          <option value="completed">已完成</option>
          <option value="cancelled">已取消</option>
        </select>
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">日期筛选</label>
        <input class="form-input" type="date" value="${resvFilter.date}" 
               onchange="resvFilter.date=this.value;renderResvList()">
      </div>
      <div style="margin-left:auto">
        <button class="btn btn-outline" onclick="resvFilter={status:'',date:''};renderReservations()">重置</button>
        <button class="btn btn-primary" onclick="showBookingModal()">➕ 新建预约</button>
      </div>
    </div>

    <div class="card">
      ${list.length ? `
        <table class="data-table">
          <thead><tr>
            <th>ID</th><th>包间</th><th>顾客</th><th>电话</th>
            <th>预约时段</th><th>影片</th><th>金额</th>
            <th>核验码</th><th>状态</th><th>操作</th>
          </tr></thead>
          <tbody>
            ${list.map(r => `<tr>
              <td>#${r.id}</td>
              <td><strong>${r.room_name}</strong><br><small style="color:var(--text-muted)">${r.room_type}</small></td>
              <td>${r.customer_name}</td>
              <td>${r.customer_phone}</td>
              <td>${fmtDT(r.start_time)}<br>~ ${fmtTime(r.end_time)}</td>
              <td>${r.movie_title || '-'}</td>
              <td style="color:var(--primary);font-weight:700">${fmtMoney(r.total_amount)}</td>
              <td><code style="background:var(--bg);padding:4px 8px;border-radius:6px">${r.checkin_code}</code></td>
              <td><span class="badge badge-${r.status}">${statusText(r.status)}</span></td>
              <td>
                ${r.status === 'booked' ? `
                  <button class="btn btn-sm btn-success" onclick="quickCheckin(${r.id})">核验</button>
                  <button class="btn btn-sm btn-outline" onclick="cancelResv(${r.id})">取消</button>
                ` : r.status === 'checked_in' ? `
                  <button class="btn btn-sm btn-danger" onclick="showCheckoutModal(${r.id})">结算</button>
                ` : r.status === 'completed' ? `
                  <button class="btn btn-sm btn-outline" onclick="showResvDetail(${r.id})">详情</button>
                ` : ''}
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      ` : '<div class="empty-state"><div class="empty-state-icon">📋</div>暂无预约记录</div>'}
    </div>
  `;
}

async function cancelResv(id) {
  if (!confirm('确定取消此预约？')) return;
  const result = await request(`${API}/reservations/${id}/cancel`, { method: 'POST' });
  if (result) {
    showToast('预约已取消', 'success');
    renderResvList();
  }
}

async function showResvDetail(id) {
  const r = await request(`${API}/reservations/${id}`);
  if (!r) return;
  const txHtml = r.transactions && r.transactions.length ?
    r.transactions.map(t => `<div class="settlement-row">
      <span>${fmtDT(t.created_at)} - ${t.type === 'payment' ? '支付' : t.type}</span>
      <span style="color:var(--success);font-weight:600">${fmtMoney(t.amount)}</span>
    </div>`).join('') : '<div style="color:var(--text-muted)">暂无支付记录</div>';

  showModal(`
    <div class="settlement-summary">
      <div class="settlement-row"><span>预约编号</span><strong>#${r.id}</strong></div>
      <div class="settlement-row"><span>包间</span><strong>${r.room_name} (${r.room_type})</strong></div>
      <div class="settlement-row"><span>顾客</span><strong>${r.customer_name} ${r.customer_phone}</strong></div>
      <div class="settlement-row"><span>影片</span><strong>${r.movie_title || '-'}</strong></div>
      <div class="settlement-row"><span>预约时段</span><strong>${fmtDT(r.start_time)} ~ ${fmtTime(r.end_time)}</strong></div>
      <div class="settlement-row"><span>入场时间</span><strong>${fmtDT(r.checkin_time)}</strong></div>
      <div class="settlement-row"><span>离场时间</span><strong>${fmtDT(r.checkout_time)}</strong></div>
      <div class="settlement-row total"><span>结算金额</span>${fmtMoney(r.total_amount)}</div>
    </div>
    <div class="card-header" style="padding:14px 0;border:none;border-top:1px solid var(--border)">
      <h3>💳 支付记录</h3>
    </div>
    ${txHtml}
  `, `订单详情 #${r.id}`);
}

// ==================== 预约弹窗 ====================

async function showBookingModal(preRoomId) {
  const rooms = await request(`${API}/rooms`);
  categoriesCache = categoriesCache.length ? categoriesCache : await request(`${API}/categories`) || [];
  moviesCache = await request(`${API}/movies`) || [];

  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const defaultStart = new Date(now.getTime() + 30 * 60 * 1000);
  const defaultEnd = new Date(defaultStart.getTime() + 2 * 60 * 60 * 1000);
  const fmtDT = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

  showModal(`
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">选择包间 *</label>
        <select class="form-select" id="b_room">
          ${rooms.filter(r => r.status !== 'maintenance').map(r => `
            <option value="${r.id}" data-price="${r.price_per_hour}" ${preRoomId==r.id?'selected':''}>
              ${r.name} - ${r.type} (${r.capacity}人) - ${fmtMoney(r.price_per_hour)}/时
            </option>
          `).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">选择影片</label>
        <select class="form-select" id="b_movie">
          <option value="">暂不选片，到店再选</option>
          ${moviesCache.map(m => `<option value="${m.id}">${m.title} (${m.duration}分钟)</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">顾客姓名 *</label>
        <input class="form-input" id="b_name" placeholder="输入顾客姓名">
      </div>
      <div class="form-group">
        <label class="form-label">联系电话 *</label>
        <input class="form-input" id="b_phone" placeholder="输入手机号">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">开始时间 *</label>
        <input class="form-input" id="b_start" type="datetime-local" value="${fmtDT(defaultStart)}" onchange="calcAmount()">
      </div>
      <div class="form-group">
        <label class="form-label">结束时间 *</label>
        <input class="form-input" id="b_end" type="datetime-local" value="${fmtDT(defaultEnd)}" onchange="calcAmount()">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">备注</label>
      <textarea class="form-textarea" id="b_remark" placeholder="特殊要求等..."></textarea>
    </div>
    <div class="settlement-summary" id="amountPreview" style="margin-bottom:16px"></div>
    ${modalFooter([
      { text: '取消', onclick: 'closeModal()' },
      { text: '确认预约', class: 'btn-primary', onclick: 'submitBooking()' }
    ])}
  `, '新建预约');
  calcAmount();
}

function calcAmount() {
  const roomSel = document.getElementById('b_room');
  const startEl = document.getElementById('b_start');
  const endEl = document.getElementById('b_end');
  if (!roomSel || !startEl || !endEl) return;

  const price = parseFloat(roomSel.selectedOptions[0]?.dataset.price || 0);
  const start = new Date(startEl.value);
  const end = new Date(endEl.value);
  const hours = Math.max(0, Math.ceil((end - start) / (1000 * 60 * 60)));
  const total = hours * price;

  document.getElementById('amountPreview').innerHTML = `
    <div class="settlement-row"><span>包间单价</span>${fmtMoney(price)} / 小时</div>
    <div class="settlement-row"><span>使用时长</span>${hours} 小时</div>
    <div class="settlement-row total"><span>预计金额</span>${fmtMoney(total)}</div>
  `;
}

async function submitBooking() {
  const data = {
    room_id: parseInt(document.getElementById('b_room').value),
    movie_id: parseInt(document.getElementById('b_movie').value) || null,
    customer_name: document.getElementById('b_name').value.trim(),
    customer_phone: document.getElementById('b_phone').value.trim(),
    start_time: document.getElementById('b_start').value,
    end_time: document.getElementById('b_end').value,
    remark: document.getElementById('b_remark').value.trim()
  };
  if (!data.customer_name || !data.customer_phone || !data.start_time || !data.end_time) {
    showToast('请填写所有必填项', 'warning');
    return;
  }
  const result = await request(`${API}/reservations`, { method: 'POST', body: data });
  if (result) {
    showToast(`预约成功！核验码: ${result.checkin_code}  金额: ${fmtMoney(result.total_amount)}`, 'success');
    closeModal();
    if (currentPage === 'reservations') renderResvList();
    else if (currentPage === 'rooms') renderRooms();
    else if (currentPage === 'dashboard') renderDashboard();
  }
}

// ==================== 到店核验 ====================

function renderCheckin() {
  setActivePage('checkin', '到店核验');
  document.getElementById('pageContent').innerHTML = `
    <div class="card checkin-panel">
      <div class="card-body" style="text-align:center;padding:40px">
        <div style="font-size:80px;margin-bottom:20px">🎟️</div>
        <h3 style="margin-bottom:10px">请输入顾客核验码</h3>
        <p style="color:var(--text-muted);margin-bottom:30px">
          核验码为6位字符，可在预约成功时获取
        </p>
        <input class="code-input" id="checkinCode" maxlength="6" 
               placeholder="XXXXXX" 
               oninput="this.value=this.value.toUpperCase()">
        <button class="btn btn-primary btn-lg" style="width:100%;margin-top:24px"
                onclick="doCheckin()">
          ✅ 确认核验入场
        </button>
      </div>
    </div>

    <div class="card" style="margin-top:28px">
      <div class="card-header"><h3>📋 待入场预约</h3></div>
      <div class="card-body" id="pendingCheckinList">
        <div class="empty-state"><div class="empty-state-icon">⏳</div>加载中...</div>
      </div>
    </div>
  `;
  setTimeout(() => document.getElementById('checkinCode')?.focus(), 100);
  loadPendingCheckin();
}

async function loadPendingCheckin() {
  const list = await request(`${API}/reservations?status=booked`);
  if (!list) return;
  const container = document.getElementById('pendingCheckinList');
  if (!container) return;
  const now = new Date().getTime();
  const upcoming = list.filter(r => new Date(r.start_time).getTime() - now < 2 * 60 * 60 * 1000);
  
  container.innerHTML = upcoming.length ?
    `<div class="upcoming-list">${upcoming.slice(0, 8).map(r => `
      <div class="upcoming-item">
        <div class="upcoming-time">${fmtDate(r.start_time)} ${fmtTime(r.start_time)}</div>
        <div class="upcoming-info">
          <strong>${r.customer_name} · ${r.room_name}</strong>
          <small>${r.movie_title || '未选片'} · 核验码: <code>${r.checkin_code}</code></small>
        </div>
        <button class="btn btn-sm btn-success" onclick="quickCheckin(${r.id});renderCheckin();">核验入场</button>
      </div>
    `).join('')}</div>` :
    '<div class="empty-state"><div class="empty-state-icon">✨</div>暂无2小时内待入场预约</div>';
}

async function doCheckin() {
  const code = document.getElementById('checkinCode').value.trim();
  if (!code || code.length < 4) {
    showToast('请输入有效的核验码', 'warning');
    return;
  }
  const result = await request(`${API}/checkin`, {
    method: 'POST',
    body: { checkin_code: code }
  });
  if (result) {
    showToast('核验成功！欢迎光临 🎉', 'success');
    document.getElementById('checkinCode').value = '';
    loadPendingCheckin();
  }
}

// ==================== 消费结算 ====================

function renderCheckout() {
  setActivePage('checkout', '消费结算');
  loadCheckoutList();
}

async function loadCheckoutList() {
  const list = await request(`${API}/reservations?status=checked_in`);
  document.getElementById('pageContent').innerHTML = list && list.length ? `
    <div class="card">
      <div class="card-header"><h3>🟢 观影中包间</h3></div>
      <table class="data-table">
        <thead><tr>
          <th>包间</th><th>顾客</th><th>电话</th><th>入场时间</th>
          <th>已用时长</th><th>影片</th><th>操作</th>
        </tr></thead>
        <tbody>
          ${list.map(r => {
            const duration = r.checkin_time ? 
              Math.ceil((new Date() - new Date(r.checkin_time)) / (1000 * 60 * 60)) : 0;
            return `<tr>
              <td><strong>${r.room_name}</strong><br><small style="color:var(--text-muted)">${r.room_type}</small></td>
              <td>${r.customer_name}</td>
              <td>${r.customer_phone}</td>
              <td>${fmtDT(r.checkin_time || r.start_time)}</td>
              <td><strong style="color:var(--primary)">${duration} 小时</strong></td>
              <td>${r.movie_title || '-'}</td>
              <td><button class="btn btn-danger" onclick="showCheckoutModal(${r.id})">💰 结算</button></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  ` : '<div class="empty-state"><div class="empty-state-icon">🎬</div>暂无观影中包间</div>';
}

let __checkoutCtx = null;

async function showCheckoutModal(reservationId) {
  let r;
  if (reservationId) {
    r = await request(`${API}/reservations/${reservationId}`);
  } else {
    const occupied = await request(`${API}/rooms?status=occupied`);
    if (!occupied || !occupied.length) {
      showToast('暂无可结算的包间', 'info');
      return;
    }
    if (occupied.length === 1) {
      r = await request(`${API}/reservations/${occupied[0].active_reservation.id}`);
    } else {
      showModal(`
        <p style="margin-bottom:16px">请选择要结算的包间：</p>
        ${occupied.map(o => `
          <button class="btn btn-outline" style="width:100%;margin-bottom:8px;text-align:left;justify-content:flex-start"
            onclick="closeModal();setTimeout(()=>showCheckoutModal(${o.active_reservation.id}),50)">
            <strong>${o.name}</strong> - ${o.active_reservation.customer_name} - ${o.active_reservation.customer_phone}
          </button>
        `).join('')}
      `, '选择结算包间');
      return;
    }
  }
  if (!r) return;

  const startTime = r.checkin_time ? new Date(r.checkin_time) : new Date(r.start_time);
  const hours = Math.max(1, Math.ceil((new Date() - startTime) / (1000 * 60 * 60)));
  const actualBase = hours * r.price_per_hour;
  const bookedTotal = r.total_amount || 0;
  const paid = r.paid_amount || 0;
  const base = Math.max(actualBase, bookedTotal);
  const discount = bookedTotal > 0 && bookedTotal < actualBase ? (actualBase - bookedTotal) : 0;
  const subtotal = base - discount;
  const unpaidBeforeExtra = subtotal - paid;

  __checkoutCtx = {
    base,
    discount,
    subtotal,
    paid,
    unpaidBeforeExtra
  };

  showModal(`
    <div class="form-row">
      <div class="form-group"><div class="form-label">包间</div><div style="font-size:16px;font-weight:600">${r.room_name} (${r.room_type})</div></div>
      <div class="form-group"><div class="form-label">顾客</div><div>${r.customer_name} · ${r.customer_phone}</div></div>
    </div>
    <div class="settlement-summary">
      <div class="settlement-row"><span>入场时间</span><span>${fmtDT(r.checkin_time || r.start_time)}</span></div>
      <div class="settlement-row"><span>当前时间</span><span>${fmtDT(new Date())}</span></div>
      <div class="settlement-row"><span>实际观影时长</span><span style="font-weight:700;color:var(--primary)">${hours} 小时</span></div>
      <div class="settlement-row"><span>包间单价</span><span>${fmtMoney(r.price_per_hour)} / 小时</span></div>
      <div class="settlement-row"><span>按实际时长计费 (${hours}h × ${fmtMoney(r.price_per_hour)})</span><span>${fmtMoney(actualBase)}</span></div>
      <div class="settlement-row"><span>预约时预估费用</span><span>${fmtMoney(bookedTotal)}</span></div>
      ${discount > 0 ? `<div class="settlement-row" style="color:var(--success)"><span>优惠减免 (按预约价计)</span><span>- ${fmtMoney(discount)}</span></div>` : ''}
      <div class="settlement-row"><span>费用小计</span><span style="font-weight:600">${fmtMoney(subtotal)}</span></div>
      <div class="settlement-row"><span>已支付金额</span><span style="color:var(--success);font-weight:600">- ${fmtMoney(paid)}</span></div>
      <div class="settlement-row total"><span>本次应付金额</span><span>${fmtMoney(Math.max(0, unpaidBeforeExtra))}</span></div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">额外收费 (小吃、饮料等)</label>
        <input class="form-input" id="extra_charge" type="number" min="0" step="0.01" value="0" oninput="updateCheckoutTotal()">
      </div>
      <div class="form-group">
        <label class="form-label">支付方式</label>
        <select class="form-select" id="payment_method">
          <option value="cash">💵 现金</option>
          <option value="wechat">💚 微信支付</option>
          <option value="alipay">💙 支付宝</option>
          <option value="card">💳 银行卡</option>
          <option value="member">🎫 会员卡</option>
        </select>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">备注</label>
      <input class="form-input" id="co_remark" placeholder="如有特殊情况请备注...">
    </div>
    <div id="checkoutFinal" style="font-size:22px;text-align:center;padding:18px;background:linear-gradient(135deg,#fef3c7,#fde68a);border-radius:12px;margin-bottom:16px;font-weight:800;color:#92400e;letter-spacing:1px"></div>
    ${modalFooter([
      { text: '取消', onclick: 'closeModal()' },
      { text: '确认结算', class: 'btn-danger', onclick: `submitCheckout(${r.id})` }
    ])}
  `, `结算 - ${r.room_name}`);
  updateCheckoutTotal();
}

function updateCheckoutTotal() {
  const extra = parseFloat(document.getElementById('extra_charge')?.value) || 0;
  const finalDiv = document.getElementById('checkoutFinal');
  if (!__checkoutCtx || !finalDiv) return;

  const { base, discount, subtotal, paid, unpaidBeforeExtra } = __checkoutCtx;
  const finalTotal = subtotal + extra - paid;

  let breakdown = `费用 ${fmtMoney(subtotal)}`;
  if (extra > 0) breakdown += ` + 附加 ${fmtMoney(extra)}`;
  if (paid > 0) breakdown += ` - 已付 ${fmtMoney(paid)}`;

  finalDiv.textContent = `最终应付: ${fmtMoney(Math.max(0, finalTotal))}`;
  finalDiv.title = breakdown;
}

async function submitCheckout(id) {
  const data = {
    extra_charge: parseFloat(document.getElementById('extra_charge').value) || 0,
    payment_method: document.getElementById('payment_method').value,
    remark: document.getElementById('co_remark').value.trim()
  };
  const result = await request(`${API}/checkout/${id}`, { method: 'POST', body: data });
  if (result) {
    const d = result;
    let detail = `实收 ${fmtMoney(d.unpaid_amount)}`;
    if (d.discount && d.discount > 0) detail += `，优惠 ${fmtMoney(d.discount)}`;
    if (d.extra_charge && d.extra_charge > 0) detail += `，附加 ${fmtMoney(d.extra_charge)}`;
    detail += `。共消费 ${d.actual_hours} 小时`;
    showToast(`✅ 结算成功！${detail}，感谢惠顾！`, 'success');
    __checkoutCtx = null;
    closeModal();
    if (currentPage === 'checkout') loadCheckoutList();
    else if (currentPage === 'rooms') renderRooms();
    else if (currentPage === 'reservations') renderResvList();
    else if (currentPage === 'dashboard') renderDashboard();
    else if (currentPage === 'transactions') renderTransactions();
  }
}

// ==================== 交易记录 ====================

async function renderTransactions() {
  setActivePage('transactions', '交易记录');
  const list = await request(`${API}/transactions`);
  if (!list) return;

  const total = list.filter(t => t.type === 'payment').reduce((s, t) => s + t.amount, 0);

  document.getElementById('pageContent').innerHTML = `
    <div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr))">
      <div class="stat-card orange">
        <div class="stat-label">交易总金额</div>
        <div class="stat-value" style="color:#f59e0b">${fmtMoney(total)}</div>
        <div class="stat-icon">💰</div>
      </div>
      <div class="stat-card blue">
        <div class="stat-label">交易笔数</div>
        <div class="stat-value">${list.length}<span class="stat-unit">笔</span></div>
        <div class="stat-icon">📋</div>
      </div>
    </div>
    <div class="card">
      ${list.length ? `
        <table class="data-table">
          <thead><tr>
            <th>时间</th><th>类型</th><th>关联订单</th><th>包间</th>
            <th>顾客</th><th>金额</th><th>支付方式</th><th>备注</th>
          </tr></thead>
          <tbody>
            ${list.map(t => `<tr>
              <td>${fmtDT(t.created_at)}</td>
              <td><span class="badge badge-${t.type === 'payment' ? 'completed' : 'booked'}">${t.type === 'payment' ? '收款' : t.type}</span></td>
              <td>#${t.reservation_id || '-'}</td>
              <td>${t.room_name || '-'}</td>
              <td>${t.customer_name || '-'}</td>
              <td style="color:var(--success);font-weight:700">${fmtMoney(t.amount)}</td>
              <td>${t.payment_method || '-'}</td>
              <td>${t.remark || '-'}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      ` : '<div class="empty-state"><div class="empty-state-icon">💳</div>暂无交易记录</div>'}
    </div>
  `;
}

// ==================== 辅助函数扩展 ====================

function deviceStatusText(status) {
  const map = { normal: '正常', warning: '预警', fault: '故障', maintenance: '维护中' };
  return map[status] || status;
}

function faultStatusText(status) {
  const map = { pending: '待处理', processing: '处理中', resolved: '已解决', closed: '已关闭' };
  return map[status] || status;
}

function faultLevelText(level) {
  const map = { low: '低', medium: '中', high: '高' };
  return map[level] || level;
}

// ==================== 巡检总览 ====================

async function renderInspectionDashboard() {
  setActivePage('inspection', '设备巡检总览');
  const data = await request(`${API}/stats/inspection`);
  if (!data) return;

  const roomStatsHtml = data.room_stats.length ?
    `<div class="card">
      <div class="card-header"><h3>🏠 各包间设备状态</h3></div>
      <table class="data-table">
        <thead><tr>
          <th>包间</th><th>设备总数</th><th>正常</th><th>预警</th><th>故障</th>
          <th>上次巡检</th><th>巡检人</th><th>操作</th>
        </tr></thead>
        <tbody>
        ${data.room_stats.map(r => `<tr>
          <td><strong>${r.room_name}</strong></td>
          <td>${r.total_devices}</td>
          <td><span style="color:var(--success);font-weight:600">${r.normal_count}</span></td>
          <td><span style="color:var(--warning);font-weight:600">${r.warning_count}</span></td>
          <td><span style="color:var(--danger);font-weight:600">${r.fault_count}</span></td>
          <td>${r.last_inspection ? fmtDT(r.last_inspection) : '<span style="color:var(--text-muted)">从未巡检</span>'}</td>
          <td>${r.inspector || '-'}</td>
          <td><button class="btn btn-sm btn-primary" onclick="showInspectionModal(${r.room_id})">📝 巡检</button></td>
        </tr>`).join('')}
        </tbody>
      </table>
    </div>` : '';

  document.getElementById('pageContent').innerHTML = `
    <div class="stats-grid">
      <div class="stat-card green">
        <div class="stat-label">今日巡检次数</div>
        <div class="stat-value">${data.today_inspection_count}<span class="stat-unit">次</span></div>
        <div class="stat-icon">📋</div>
      </div>
      <div class="stat-card blue">
        <div class="stat-label">累计巡检</div>
        <div class="stat-value">${data.total_inspections}<span class="stat-unit">次</span></div>
        <div class="stat-icon">📊</div>
      </div>
      <div class="stat-card red">
        <div class="stat-label">待处理故障</div>
        <div class="stat-value">${data.pending_faults}<span class="stat-unit">项</span></div>
        <div class="stat-icon">⚠️</div>
      </div>
      <div class="stat-card orange">
        <div class="stat-label">处理中故障</div>
        <div class="stat-value">${data.processing_faults}<span class="stat-unit">项</span></div>
        <div class="stat-icon">🔧</div>
      </div>
      <div class="stat-card purple">
        <div class="stat-label">设备总数</div>
        <div class="stat-value">${data.total_devices}<span class="stat-unit">台</span></div>
        <div class="stat-icon">⚙️</div>
      </div>
    </div>

    <div class="two-col">
      <div class="card">
        <div class="card-header"><h3>📊 设备状态分布</h3></div>
        <div class="card-body">
          <div class="stats-grid" style="grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:0">
            <div class="stat-card green" style="padding:14px">
              <div class="stat-label">正常</div>
              <div class="stat-value" style="font-size:22px;color:var(--success)">${data.normal_devices}</div>
            </div>
            <div class="stat-card orange" style="padding:14px">
              <div class="stat-label">预警</div>
              <div class="stat-value" style="font-size:22px;color:var(--warning)">${data.warning_devices}</div>
            </div>
            <div class="stat-card red" style="padding:14px">
              <div class="stat-label">故障</div>
              <div class="stat-value" style="font-size:22px;color:var(--danger)">${data.fault_devices}</div>
            </div>
            <div class="stat-card" style="padding:14px">
              <div class="stat-label">维护中</div>
              <div class="stat-value" style="font-size:22px">${data.maintenance_devices}</div>
            </div>
          </div>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><h3>💰 维修费用统计</h3></div>
        <div class="card-body">
          <div class="stats-grid" style="grid-template-columns:repeat(2,1fr);gap:12px;margin-bottom:0">
            <div class="stat-card orange">
              <div class="stat-label">本月维修费用</div>
              <div class="stat-value" style="color:#f59e0b;font-size:22px">${fmtMoney(data.month_repair_cost)}</div>
              <div class="stat-icon" style="font-size:20px">📅</div>
            </div>
            <div class="stat-card purple">
              <div class="stat-label">累计维修费用</div>
              <div class="stat-value" style="font-size:22px">${fmtMoney(data.total_repair_cost)}</div>
              <div class="stat-icon" style="font-size:20px">📈</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    ${roomStatsHtml}
  `;
}

// ==================== 设备管理 ====================

let deviceFilter = { room_id: '', status: '', type: '' };
let roomsCache = [];

const DEVICE_TYPES = [
  { type: 'projector', name: '投影机', icon: '📽️' },
  { type: 'speaker', name: '音响系统', icon: '🔊' },
  { type: 'ac', name: '空调', icon: '❄️' },
  { type: 'light', name: '灯光系统', icon: '💡' },
  { type: 'screen', name: '幕布', icon: '🎞️' },
  { type: 'sofa', name: '沙发座椅', icon: '🛋️' },
  { type: 'other', name: '其他设备', icon: '🔧' }
];

async function renderDevices() {
  setActivePage('devices', '设备管理');
  roomsCache = await request(`${API}/rooms`) || [];
  await renderDeviceList();
}

async function renderDeviceList() {
  let url = `${API}/devices`;
  const params = [];
  if (deviceFilter.room_id) params.push(`room_id=${deviceFilter.room_id}`);
  if (deviceFilter.status) params.push(`status=${deviceFilter.status}`);
  if (deviceFilter.type) params.push(`type=${deviceFilter.type}`);
  if (params.length) url += '?' + params.join('&');

  const list = await request(url);
  if (!list) return;

  document.getElementById('pageContent').innerHTML = `
    <div class="filter-bar">
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">包间筛选</label>
        <select class="form-select" onchange="deviceFilter.room_id=this.value;renderDeviceList()">
          <option value="">全部包间</option>
          ${roomsCache.map(r => `<option value="${r.id}" ${deviceFilter.room_id==r.id?'selected':''}>${r.name}</option>`).join('')}
        </select>
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">状态筛选</label>
        <select class="form-select" onchange="deviceFilter.status=this.value;renderDeviceList()">
          <option value="">全部状态</option>
          <option value="normal" ${deviceFilter.status=='normal'?'selected':''}>正常</option>
          <option value="warning" ${deviceFilter.status=='warning'?'selected':''}>预警</option>
          <option value="fault" ${deviceFilter.status=='fault'?'selected':''}>故障</option>
          <option value="maintenance" ${deviceFilter.status=='maintenance'?'selected':''}>维护中</option>
        </select>
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">设备类型</label>
        <select class="form-select" onchange="deviceFilter.type=this.value;renderDeviceList()">
          <option value="">全部类型</option>
          ${DEVICE_TYPES.map(t => `<option value="${t.type}" ${deviceFilter.type==t.type?'selected':''}>${t.icon} ${t.name}</option>`).join('')}
        </select>
      </div>
      <div style="margin-left:auto">
        <button class="btn btn-outline" onclick="deviceFilter={room_id:'',status:'',type:''};renderDeviceList()">重置</button>
        <button class="btn btn-primary" onclick="showAddDeviceModal()">➕ 添加设备</button>
      </div>
    </div>

    <div class="card">
      ${list.length ? `
        <table class="data-table">
          <thead><tr>
            <th>设备</th><th>类型</th><th>所属包间</th>
            <th>品牌/型号</th><th>购置日期</th><th>上次巡检</th>
            <th>状态</th><th>操作</th>
          </tr></thead>
          <tbody>
            ${list.map(d => `<tr>
              <td><strong>${d.icon} ${d.name}</strong></td>
              <td>${d.type_name}</td>
              <td>${d.room_name || '-'}</td>
              <td>${d.brand || '-'} ${d.model || ''}</td>
              <td>${d.purchase_date || '-'}</td>
              <td>${d.last_inspection ? fmtDT(d.last_inspection) : '<span style="color:var(--text-muted)">未巡检</span>'}</td>
              <td><span class="device-status device-status-${d.status}">${deviceStatusText(d.status)}</span>
                ${d.active_fault_count ? `<br><small style="color:var(--danger)">待处理故障 ${d.active_fault_count}项</small>` : ''}</td>
              <td>
                <button class="btn btn-sm btn-outline" onclick="showDeviceDetail(${d.id})">详情</button>
                <button class="btn btn-sm btn-warning" onclick="showEditDeviceModal(${d.id})">编辑</button>
                <button class="btn btn-sm btn-danger" onclick="deleteDevice(${d.id})">删除</button>
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      ` : '<div class="empty-state"><div class="empty-state-icon">⚙️</div>暂无设备</div>'}
    </div>
  `;
}

function showAddDeviceModal() {
  showModal(`
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">所属包间 *</label>
        <select class="form-select" id="d_room">
          ${roomsCache.map(r => `<option value="${r.id}">${r.name}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">设备类型 *</label>
        <select class="form-select" id="d_type" onchange="onDeviceTypeChange()">
          ${DEVICE_TYPES.map(t => `<option value="${t.type}" data-name="${t.name}" data-icon="${t.icon}">${t.icon} ${t.name}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">设备名称 *</label>
        <input class="form-input" id="d_name" placeholder="如：A101-投影机">
      </div>
      <div class="form-group">
        <label class="form-label">品牌</label>
        <input class="form-input" id="d_brand" placeholder="如：爱普生">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">型号</label>
        <input class="form-input" id="d_model" placeholder="如：CB-X41">
      </div>
      <div class="form-group">
        <label class="form-label">购置日期</label>
        <input class="form-input" type="date" id="d_date">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">备注</label>
      <textarea class="form-textarea" id="d_remark"></textarea>
    </div>
    ${modalFooter([
      { text: '取消', onclick: 'closeModal()' },
      { text: '添加设备', class: 'btn-primary', onclick: 'submitAddDevice()' }
    ])}
  `, '添加设备');
  setTimeout(() => onDeviceTypeChange(), 50);
}

function onDeviceTypeChange() {
  const sel = document.getElementById('d_type');
  const roomSel = document.getElementById('d_room');
  if (!sel || !roomSel) return;
  const opt = sel.selectedOptions[0];
  const roomName = roomsCache.find(r => r.id == roomSel.value)?.name || '';
  const nameInput = document.getElementById('d_name');
  if (nameInput && !nameInput.value) {
    nameInput.value = `${roomName}-${opt.dataset.name}`;
  }
}

async function submitAddDevice() {
  const typeSel = document.getElementById('d_type');
  const opt = typeSel.selectedOptions[0];
  const data = {
    room_id: parseInt(document.getElementById('d_room').value),
    name: document.getElementById('d_name').value.trim(),
    type: typeSel.value,
    type_name: opt.dataset.name,
    icon: opt.dataset.icon,
    brand: document.getElementById('d_brand').value.trim(),
    model: document.getElementById('d_model').value.trim(),
    purchase_date: document.getElementById('d_date').value || null,
    remark: document.getElementById('d_remark').value.trim()
  };
  if (!data.name) {
    showToast('请填写设备名称', 'warning');
    return;
  }
  const result = await request(`${API}/devices`, { method: 'POST', body: data });
  if (result) {
    showToast('设备添加成功', 'success');
    closeModal();
    renderDeviceList();
  }
}

async function showDeviceDetail(id) {
  const dev = await request(`${API}/devices/${id}`);
  if (!dev) return;

  const faultsHtml = dev.fault_history && dev.fault_history.length ?
    `<table class="data-table">
      <thead><tr><th>时间</th><th>标题</th><th>级别</th><th>状态</th></tr></thead>
      <tbody>
      ${dev.fault_history.map(f => `<tr>
        <td>${fmtDT(f.created_at)}</td>
        <td>${f.title}</td>
        <td><span class="badge badge-${f.level}">${faultLevelText(f.level)}</span></td>
        <td>${faultStatusText(f.status)}</td>
      </tr>`).join('')}
      </tbody></table>` :
    '<div style="text-align:center;color:var(--text-muted);padding:20px">暂无故障记录</div>';

  const inspectHtml = dev.recent_inspections && dev.recent_inspections.length ?
    `<table class="data-table">
      <thead><tr><th>时间</th><th>巡检人</th><th>结果</th><th>备注</th></tr></thead>
      <tbody>
      ${dev.recent_inspections.map(i => {
        const item = i.items?.find(it => it.device_id === id);
        return `<tr>
          <td>${fmtDT(i.created_at)}</td>
          <td>${i.inspector}</td>
          <td>${item ? `<span class="device-status device-status-${item.status}">${deviceStatusText(item.status)}</span>` : '-'}</td>
          <td>${item?.note || '-'}</td>
        </tr>`;
      }).join('')}
      </tbody></table>` :
    '<div style="text-align:center;color:var(--text-muted);padding:20px">暂无巡检记录</div>';

  showModal(`
    <div class="form-row">
      <div>
        <div class="stat-card" style="box-shadow:none;border:1px solid var(--border)">
          <div class="stat-label">设备</div>
          <div class="stat-value" style="font-size:18px">${dev.icon} ${dev.name}</div>
        </div>
      </div>
      <div>
        <div class="stat-card" style="box-shadow:none;border:1px solid var(--border)">
          <div class="stat-label">当前状态</div>
          <div class="stat-value" style="font-size:18px"><span class="device-status device-status-${dev.status}">${deviceStatusText(dev.status)}</span></div>
        </div>
      </div>
    </div>
    <div class="form-row" style="margin-top:12px">
      <div class="form-group"><div class="form-label">所属包间</div><div>${dev.room_name || '-'}</div></div>
      <div class="form-group"><div class="form-label">设备类型</div><div>${dev.type_name}</div></div>
      <div class="form-group"><div class="form-label">品牌/型号</div><div>${dev.brand || '-'} ${dev.model || ''}</div></div>
    </div>
    <div class="form-row">
      <div class="form-group"><div class="form-label">购置日期</div><div>${dev.purchase_date || '-'}</div></div>
      <div class="form-group"><div class="form-label">上次巡检</div><div>${dev.last_inspection ? fmtDT(dev.last_inspection) : '未巡检'}</div></div>
      <div class="form-group"><div class="form-label">备注</div><div>${dev.remark || '-'}</div></div>
    </div>
    <div class="card-header" style="padding:12px 0;border:none;border-top:1px solid var(--border)"><h3>📋 最近巡检记录</h3></div>
    ${inspectHtml}
    <div class="card-header" style="padding:12px 0;border:none;border-top:1px solid var(--border)"><h3>⚠️ 故障历史</h3></div>
    ${faultsHtml}
  `, `设备详情 - ${dev.name}`, true);
}

let __editDev = null;
async function showEditDeviceModal(id) {
  const dev = await request(`${API}/devices/${id}`);
  if (!dev) return;
  __editDev = dev;

  showModal(`
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">所属包间 *</label>
        <select class="form-select" id="ed_room">
          ${roomsCache.map(r => `<option value="${r.id}" ${dev.room_id==r.id?'selected':''}>${r.name}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">设备类型 *</label>
        <select class="form-select" id="ed_type">
          ${DEVICE_TYPES.map(t => `<option value="${t.type}" data-name="${t.name}" data-icon="${t.icon}" ${dev.type==t.type?'selected':''}>${t.icon} ${t.name}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">设备名称 *</label>
        <input class="form-input" id="ed_name" value="${dev.name}">
      </div>
      <div class="form-group">
        <label class="form-label">品牌</label>
        <input class="form-input" id="ed_brand" value="${dev.brand || ''}">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">型号</label>
        <input class="form-input" id="ed_model" value="${dev.model || ''}">
      </div>
      <div class="form-group">
        <label class="form-label">购置日期</label>
        <input class="form-input" type="date" id="ed_date" value="${dev.purchase_date || ''}">
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">状态</label>
        <select class="form-select" id="ed_status">
          <option value="normal" ${dev.status=='normal'?'selected':''}>正常</option>
          <option value="warning" ${dev.status=='warning'?'selected':''}>预警</option>
          <option value="fault" ${dev.status=='fault'?'selected':''}>故障</option>
          <option value="maintenance" ${dev.status=='maintenance'?'selected':''}>维护中</option>
        </select>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">备注</label>
      <textarea class="form-textarea" id="ed_remark">${dev.remark || ''}</textarea>
    </div>
    ${modalFooter([
      { text: '取消', onclick: 'closeModal();__editDev=null' },
      { text: '保存修改', class: 'btn-primary', onclick: 'submitEditDevice()' }
    ])}
  `, '编辑设备');
}

async function submitEditDevice() {
  if (!__editDev) return;
  const typeSel = document.getElementById('ed_type');
  const opt = typeSel.selectedOptions[0];
  const data = {
    room_id: parseInt(document.getElementById('ed_room').value),
    name: document.getElementById('ed_name').value.trim(),
    type: typeSel.value,
    type_name: opt.dataset.name,
    icon: opt.dataset.icon,
    brand: document.getElementById('ed_brand').value.trim(),
    model: document.getElementById('ed_model').value.trim(),
    purchase_date: document.getElementById('ed_date').value || null,
    status: document.getElementById('ed_status').value,
    remark: document.getElementById('ed_remark').value.trim()
  };
  if (!data.name) {
    showToast('请填写设备名称', 'warning');
    return;
  }
  const result = await request(`${API}/devices/${__editDev.id}`, { method: 'PUT', body: data });
  if (result) {
    showToast('设备信息已更新', 'success');
    __editDev = null;
    closeModal();
    renderDeviceList();
  }
}

async function deleteDevice(id) {
  if (!confirm('确定删除此设备？删除后无法恢复！')) return;
  const result = await request(`${API}/devices/${id}`, { method: 'DELETE' });
  if (result) {
    showToast('设备已删除', 'success');
    renderDeviceList();
  }
}

// ==================== 巡检登记 ====================

async function renderInspectionRegister() {
  setActivePage('inspection-register', '巡检任务登记');
  roomsCache = await request(`${API}/rooms`) || [];

  const recentInspections = await request(`${API}/inspections?start_date=${new Date(Date.now()-7*24*60*60*1000).toISOString().split('T')[0]}`) || [];

  const recentHtml = recentInspections.length ?
    `<div class="card" style="margin-top:24px">
      <div class="card-header"><h3>🕐 最近7天巡检记录</h3></div>
      <table class="data-table">
        <thead><tr>
          <th>时间</th><th>包间</th><th>巡检人</th>
          <th>设备数</th><th>异常数</th><th>操作</th>
        </tr></thead>
        <tbody>
        ${recentInspections.slice(0,10).map(r => `<tr>
          <td>${fmtDT(r.created_at)}</td>
          <td><strong>${r.room_name}</strong></td>
          <td>${r.inspector}</td>
          <td>${r.device_results?.length || 0}</td>
          <td>
            ${r.fault_count ? `<span style="color:var(--danger);font-weight:600">故障 ${r.fault_count}</span>` : ''}
            ${r.warning_count ? `<span style="color:var(--warning);font-weight:600"> 预警 ${r.warning_count}</span>` : ''}
            ${!r.fault_count && !r.warning_count ? '<span style="color:var(--success)">全部正常</span>' : ''}
          </td>
          <td><button class="btn btn-sm btn-outline" onclick="showInspectionDetail(${r.id})">详情</button></td>
        </tr>`).join('')}
        </tbody>
      </table>
    </div>` : '';

  document.getElementById('pageContent').innerHTML = `
    <div class="card">
      <div class="card-header"><h3>📝 选择包间开始巡检</h3></div>
      <div class="card-body">
        <p style="color:var(--text-muted);margin-bottom:18px">巡检将检查包间内所有绑定的设备（投影、音响、空调、灯光等），可登记设备状态、发现故障、记录备注。</p>
        <div class="rooms-grid">
          ${roomsCache.map(r => `
            <div class="room-card status-idle" style="cursor:pointer" onclick="showInspectionModal(${r.id})">
              <div class="room-header">
                <div class="room-name">${r.name}</div>
                <div class="room-status ${r.status}">${statusText(r.status)}</div>
              </div>
              <div class="room-type">${r.type}</div>
              <div class="room-info"><span>👥 ${r.capacity}人</span></div>
              <div class="room-actions" style="margin-top:12px">
                <button class="btn btn-primary btn-sm" style="width:100%;justify-content:center" onclick="event.stopPropagation();showInspectionModal(${r.id})">
                  📋 开始巡检
                </button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
    ${recentHtml}
  `;
}

let __inspectCtx = null;

async function showInspectionModal(roomId) {
  const devices = await request(`${API}/devices?room_id=${roomId}`);
  const room = roomsCache.find(r => r.id === roomId);
  if (!devices || !devices.length) {
    showToast('该包间暂无绑定设备', 'warning');
    return;
  }

  __inspectCtx = { room_id: roomId, items: [] };
  devices.forEach(d => __inspectCtx.items.push({
    device_id: d.id,
    status: 'normal',
    note: '',
    fault_level: 'medium'
  }));

  showModal(`
    <div class="stat-card" style="box-shadow:none;border:1px solid var(--border);margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div>
          <div class="stat-label">巡检包间</div>
          <div class="stat-value" style="font-size:20px">${room?.name} <small style="font-weight:400;color:var(--text-muted)">${room?.type}</small></div>
        </div>
        <div style="font-size:40px">🛠️</div>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">巡检人 *</label>
      <input class="form-input" id="inspector" placeholder="请输入巡检人姓名">
    </div>
    <h4 style="margin:16px 0 12px;font-size:15px">📋 设备巡检清单</h4>
    <div id="inspectionItems" style="display:flex;flex-direction:column;gap:10px">
      ${devices.map((d, idx) => `
        <div class="inspection-item" data-idx="${idx}">
          <div class="inspection-item-head">
            <div style="display:flex;align-items:center;gap:8px">
              <span style="font-size:20px">${d.icon}</span>
              <div>
                <div style="font-weight:600">${d.type_name}</div>
                <small style="color:var(--text-muted)">${d.brand || ''} ${d.model || ''} · 状态: <span class="device-status device-status-${d.status}">${deviceStatusText(d.status)}</span></small>
              </div>
            </div>
            <div class="status-radio-group">
              <label class="status-radio status-radio-normal">
                <input type="radio" name="status_${idx}" value="normal" checked onchange="updateInspectItem(${idx},'status','normal')">
                <span>正常</span>
              </label>
              <label class="status-radio status-radio-warning">
                <input type="radio" name="status_${idx}" value="warning" onchange="updateInspectItem(${idx},'status','warning')">
                <span>预警</span>
              </label>
              <label class="status-radio status-radio-fault">
                <input type="radio" name="status_${idx}" value="fault" onchange="updateInspectItem(${idx},'status','fault')">
                <span>故障</span>
              </label>
            </div>
          </div>
          <div class="inspection-item-body" id="inspect_body_${idx}" style="display:none">
            <div class="form-row">
              <div class="form-group" style="margin-bottom:0">
                <label class="form-label">故障级别</label>
                <select class="form-select" onchange="updateInspectItem(${idx},'fault_level',this.value)">
                  <option value="low">低</option>
                  <option value="medium" selected>中</option>
                  <option value="high">高</option>
                </select>
              </div>
            </div>
            <div class="form-group" style="margin-bottom:0">
              <label class="form-label">备注说明</label>
              <textarea class="form-textarea" style="min-height:50px" placeholder="请描述问题..." oninput="updateInspectItem(${idx},'note',this.value)"></textarea>
            </div>
          </div>
        </div>
      `).join('')}
    </div>
    <div class="form-group" style="margin-top:16px">
      <label class="form-label">巡检备注</label>
      <textarea class="form-textarea" id="inspect_remark" placeholder="本次巡检整体情况备注..."></textarea>
    </div>
    ${modalFooter([
      { text: '取消', onclick: 'closeModal();__inspectCtx=null' },
      { text: '提交巡检', class: 'btn-primary', onclick: 'submitInspection()' }
    ])}
  `, `包间巡检 - ${room?.name}`, true);
}

function updateInspectItem(idx, field, value) {
  if (!__inspectCtx) return;
  __inspectCtx.items[idx][field] = value;
  const body = document.getElementById(`inspect_body_${idx}`);
  if (field === 'status') {
    if (body) body.style.display = (value === 'normal') ? 'none' : 'block';
  }
}

async function submitInspection() {
  if (!__inspectCtx) return;
  const inspector = document.getElementById('inspector').value.trim();
  if (!inspector) {
    showToast('请填写巡检人姓名', 'warning');
    return;
  }
  const remark = document.getElementById('inspect_remark').value.trim();
  const data = {
    room_id: __inspectCtx.room_id,
    inspector,
    items: __inspectCtx.items,
    remark
  };
  const result = await request(`${API}/inspections`, { method: 'POST', body: data });
  if (result) {
    const msg = result.fault_ids?.length ?
      `巡检已提交！发现 ${result.fault_ids.length} 项故障，已自动上报` :
      '巡检已提交，全部设备状态良好';
    showToast(msg, result.fault_ids?.length ? 'warning' : 'success');
    __inspectCtx = null;
    closeModal();
    if (currentPage === 'inspection-register') renderInspectionRegister();
    else if (currentPage === 'inspection') renderInspectionDashboard();
    else if (currentPage === 'devices') renderDeviceList();
    else if (currentPage === 'faults') renderFaults();
  }
}

async function showInspectionDetail(id) {
  const ins = await request(`${API}/inspections/${id}`);
  if (!ins) return;

  const faultHtml = ins.related_faults?.length ?
    `<div class="card-header" style="padding:14px 0;border:none;border-top:1px solid var(--border);margin-top:8px">
      <h3>⚠️ 关联故障记录</h3></div>
      <table class="data-table">
        <thead><tr><th>标题</th><th>级别</th><th>状态</th></tr></thead>
        <tbody>
        ${ins.related_faults.map(f => `<tr>
          <td>${f.title}</td>
          <td><span class="badge badge-${f.level}">${faultLevelText(f.level)}</span></td>
          <td>${faultStatusText(f.status)}</td>
        </tr>`).join('')}
        </tbody></table>` : '';

  showModal(`
    <div class="settlement-summary">
      <div class="settlement-row"><span>巡检编号</span><strong>#${ins.id}</strong></div>
      <div class="settlement-row"><span>巡检包间</span><strong>${ins.room_name}</strong></div>
      <div class="settlement-row"><span>巡检人</span><strong>${ins.inspector}</strong></div>
      <div class="settlement-row"><span>巡检时间</span><strong>${fmtDT(ins.created_at)}</strong></div>
      <div class="settlement-row"><span>巡检设备</span><strong>${ins.device_results?.length || 0} 台</strong></div>
    </div>
    <h4 style="margin-bottom:12px;font-size:15px">📋 设备巡检结果</h4>
    <table class="data-table">
      <thead><tr><th>设备</th><th>状态</th><th>备注</th></tr></thead>
      <tbody>
      ${(ins.device_results || []).map(r => `<tr>
        <td><strong>${r.device_icon} ${r.device_type}</strong></td>
        <td><span class="device-status device-status-${r.status}">${deviceStatusText(r.status)}</span></td>
        <td>${r.note || '-'}</td>
      </tr>`).join('')}
      </tbody>
    </table>
    ${ins.remark ? `<div style="margin-top:14px;padding:12px;background:var(--bg);border-radius:8px"><strong>备注:</strong> ${ins.remark}</div>` : ''}
    ${faultHtml}
  `, `巡检记录详情 #${ins.id}`, true);
}

// ==================== 故障维修 ====================

let faultFilter = { room_id: '', status: '', level: '' };
let devicesCache = [];

async function renderFaults() {
  setActivePage('faults', '故障上报与维修');
  roomsCache = await request(`${API}/rooms`) || [];
  await renderFaultList();
}

async function renderFaultList() {
  let url = `${API}/faults`;
  const params = [];
  if (faultFilter.room_id) params.push(`room_id=${faultFilter.room_id}`);
  if (faultFilter.status) params.push(`status=${faultFilter.status}`);
  if (faultFilter.level) params.push(`level=${faultFilter.level}`);
  if (params.length) url += '?' + params.join('&');

  const list = await request(url);
  if (!list) return;
  devicesCache = await request(`${API}/devices${faultFilter.room_id ? '?room_id=' + faultFilter.room_id : ''}`) || [];

  document.getElementById('pageContent').innerHTML = `
    <div class="filter-bar">
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">包间筛选</label>
        <select class="form-select" onchange="faultFilter.room_id=this.value;renderFaultList()">
          <option value="">全部包间</option>
          ${roomsCache.map(r => `<option value="${r.id}" ${faultFilter.room_id==r.id?'selected':''}>${r.name}</option>`).join('')}
        </select>
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">状态筛选</label>
        <select class="form-select" onchange="faultFilter.status=this.value;renderFaultList()">
          <option value="">全部状态</option>
          <option value="pending" ${faultFilter.status=='pending'?'selected':''}>待处理</option>
          <option value="processing" ${faultFilter.status=='processing'?'selected':''}>处理中</option>
          <option value="resolved" ${faultFilter.status=='resolved'?'selected':''}>已解决</option>
          <option value="closed" ${faultFilter.status=='closed'?'selected':''}>已关闭</option>
        </select>
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">故障级别</label>
        <select class="form-select" onchange="faultFilter.level=this.value;renderFaultList()">
          <option value="">全部级别</option>
          <option value="high" ${faultFilter.level=='high'?'selected':''}>高</option>
          <option value="medium" ${faultFilter.level=='medium'?'selected':''}>中</option>
          <option value="low" ${faultFilter.level=='low'?'selected':''}>低</option>
        </select>
      </div>
      <div style="margin-left:auto">
        <button class="btn btn-outline" onclick="faultFilter={room_id:'',status:'',level:''};renderFaultList()">重置</button>
        <button class="btn btn-danger" onclick="showAddFaultModal()">⚠️ 上报故障</button>
      </div>
    </div>

    <div class="card">
      ${list.length ? `
        <table class="data-table">
          <thead><tr>
            <th>ID</th><th>设备</th><th>包间</th><th>标题</th>
            <th>级别</th><th>上报人</th><th>上报时间</th>
            <th>状态</th><th>操作</th>
          </tr></thead>
          <tbody>
            ${list.map(f => `<tr>
              <td>#${f.id}</td>
              <td><strong>${f.device_icon} ${f.device_type}</strong><br><small style="color:var(--text-muted)">${f.device_name}</small></td>
              <td>${f.room_name || '-'}</td>
              <td>${f.title}<br><small style="color:var(--text-muted)">${f.description || ''}</small></td>
              <td><span class="badge badge-${f.level}">${faultLevelText(f.level)}</span></td>
              <td>${f.reported_by}</td>
              <td>${fmtDT(f.created_at)}</td>
              <td><span class="fault-status fault-status-${f.status}">${faultStatusText(f.status)}</span>
                ${f.repair_info ? `<br><small>维修: ${f.repair_info.repairer}</small>` : ''}</td>
              <td>
                ${['pending', 'processing'].includes(f.status) ?
                  `<button class="btn btn-sm btn-success" onclick="showRepairModal(${f.id})">🔧 维修</button>` : ''}
                ${f.status === 'pending' ?
                  `<button class="btn btn-sm btn-info" onclick="updateFaultStatus(${f.id},'processing')">接单</button>` : ''}
                ${['resolved', 'closed'].includes(f.status) ?
                  `<button class="btn btn-sm btn-outline" onclick="showFaultDetail(${f.id})">查看</button>` : ''}
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      ` : '<div class="empty-state"><div class="empty-state-icon">✨</div>暂无故障记录</div>'}
    </div>
  `;
}

function showAddFaultModal() {
  showModal(`
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">所属包间</label>
        <select class="form-select" id="f_room" onchange="onFaultRoomChange()">
          <option value="">请选择</option>
          ${roomsCache.map(r => `<option value="${r.id}">${r.name}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">故障设备 *</label>
        <select class="form-select" id="f_device">
          <option value="">请先选择包间</option>
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">故障级别</label>
        <select class="form-select" id="f_level">
          <option value="low">低</option>
          <option value="medium" selected>中</option>
          <option value="high">高</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label">上报人</label>
        <input class="form-input" id="f_reporter" placeholder="您的姓名">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">故障标题 *</label>
      <input class="form-input" id="f_title" placeholder="简短描述故障，如：投影机无法开机">
    </div>
    <div class="form-group">
      <label class="form-label">详细描述</label>
      <textarea class="form-textarea" id="f_desc" placeholder="详细描述故障现象、发生时间等..."></textarea>
    </div>
    ${modalFooter([
      { text: '取消', onclick: 'closeModal()' },
      { text: '提交上报', class: 'btn-danger', onclick: 'submitAddFault()' }
    ])}
  `, '故障上报');
}

function onFaultRoomChange() {
  const roomId = document.getElementById('f_room').value;
  const devSel = document.getElementById('f_device');
  if (!roomId) {
    devSel.innerHTML = '<option value="">请先选择包间</option>';
    return;
  }
  const devs = devicesCache.filter(d => d.room_id == roomId);
  devSel.innerHTML = devs.length ?
    devs.map(d => `<option value="${d.id}">${d.icon} ${d.type_name} - ${d.name}</option>`).join('') :
    '<option value="">该包间暂无设备</option>';
}

async function submitAddFault() {
  const device_id = parseInt(document.getElementById('f_device').value);
  if (!device_id) {
    showToast('请选择故障设备', 'warning');
    return;
  }
  const data = {
    device_id,
    room_id: parseInt(document.getElementById('f_room').value) || null,
    title: document.getElementById('f_title').value.trim(),
    description: document.getElementById('f_desc').value.trim(),
    level: document.getElementById('f_level').value,
    reported_by: document.getElementById('f_reporter').value.trim() || '员工'
  };
  if (!data.title) {
    showToast('请填写故障标题', 'warning');
    return;
  }
  const result = await request(`${API}/faults`, { method: 'POST', body: data });
  if (result) {
    showToast('故障已上报，请尽快安排维修', 'warning');
    closeModal();
    renderFaultList();
  }
}

let __repairFaultId = null;

async function showRepairModal(faultId) {
  const faults = await request(`${API}/faults`);
  const fault = faults?.find(f => f.id === faultId);
  if (!fault) return;
  __repairFaultId = faultId;

  showModal(`
    <div class="stat-card" style="box-shadow:none;border:1px solid var(--border);margin-bottom:16px">
      <div class="stat-label">故障信息</div>
      <div style="margin-top:6px">
        <strong>${fault.device_icon} ${fault.device_type}</strong> · ${fault.room_name}
        <br><span class="badge badge-${fault.level}" style="margin-top:4px">${faultLevelText(fault.level)}</span>
        <div style="margin-top:8px;color:var(--text-muted)">${fault.title}</div>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">维修人员 *</label>
        <input class="form-input" id="r_repairer" placeholder="请输入维修人员姓名">
      </div>
      <div class="form-group">
        <label class="form-label">维修费用</label>
        <input class="form-input" id="r_cost" type="number" min="0" step="0.01" value="0" placeholder="0.00">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">维修方式 *</label>
      <select class="form-select" id="r_method">
        <option value="">请选择</option>
        <option value="自行维修">自行维修</option>
        <option value="更换配件">更换配件</option>
        <option value="厂家保修">厂家保修</option>
        <option value="外包维修">外包维修</option>
        <option value="设备重置">设备重置/重启</option>
        <option value="清洁保养">清洁保养</option>
        <option value="其他">其他方式</option>
      </select>
    </div>
    <div class="form-group">
      <label class="form-label">更换配件</label>
      <input class="form-input" id="r_parts" placeholder="如：投影仪灯泡、过滤网等">
    </div>
    <div class="form-group">
      <label class="form-label">维修备注 *</label>
      <textarea class="form-textarea" id="r_note" placeholder="详细描述维修过程、结果、注意事项等..."></textarea>
    </div>
    ${modalFooter([
      { text: '取消', onclick: 'closeModal();__repairFaultId=null' },
      { text: '完成维修', class: 'btn-success', onclick: 'submitRepair()' }
    ])}
  `, '维修记录填写');
}

async function submitRepair() {
  if (!__repairFaultId) return;
  const data = {
    fault_id: __repairFaultId,
    repairer: document.getElementById('r_repairer').value.trim(),
    repair_method: document.getElementById('r_method').value,
    parts_used: document.getElementById('r_parts').value.trim(),
    cost: parseFloat(document.getElementById('r_cost').value) || 0,
    repair_note: document.getElementById('r_note').value.trim()
  };
  if (!data.repairer || !data.repair_method || !data.repair_note) {
    showToast('请填写维修人员、维修方式和备注', 'warning');
    return;
  }
  const result = await request(`${API}/repairs`, { method: 'POST', body: data });
  if (result) {
    showToast('维修记录已保存，故障已解决', 'success');
    __repairFaultId = null;
    closeModal();
    renderFaultList();
  }
}

async function updateFaultStatus(id, status) {
  const result = await request(`${API}/faults/${id}/status`, {
    method: 'PUT',
    body: { status }
  });
  if (result) {
    showToast('状态已更新', 'success');
    renderFaultList();
  }
}

async function showFaultDetail(id) {
  const faults = await request(`${API}/faults`);
  const fault = faults?.find(f => f.id === id);
  const repairs = await request(`${API}/repairs`);
  const repair = repairs?.find(r => r.fault_id === id);
  if (!fault) return;

  const repairHtml = repair ? `
    <div class="card-header" style="padding:14px 0;border:none;border-top:1px solid var(--border);margin-top:8px">
      <h3>🔧 维修记录</h3></div>
    <div class="settlement-summary">
      <div class="settlement-row"><span>维修人员</span><strong>${repair.repairer}</strong></div>
      <div class="settlement-row"><span>维修方式</span><strong>${repair.repair_method}</strong></div>
      <div class="settlement-row"><span>更换配件</span><strong>${repair.parts_used || '-'}</strong></div>
      <div class="settlement-row"><span>维修费用</span><strong style="color:var(--danger)">${fmtMoney(repair.cost || 0)}</strong></div>
      <div class="settlement-row"><span>维修时间</span><strong>${fmtDT(repair.created_at)}</strong></div>
      <div class="settlement-row total" style="border:none;padding-top:8px;margin-top:0"><span>维修备注</span>${repair.repair_note || '-'}</div>
    </div>` : '';

  showModal(`
    <div class="settlement-summary">
      <div class="settlement-row"><span>故障编号</span><strong>#${fault.id}</strong></div>
      <div class="settlement-row"><span>故障设备</span><strong>${fault.device_icon} ${fault.device_name}</strong></div>
      <div class="settlement-row"><span>所属包间</span><strong>${fault.room_name}</strong></div>
      <div class="settlement-row"><span>故障级别</span><span class="badge badge-${fault.level}">${faultLevelText(fault.level)}</span></div>
      <div class="settlement-row"><span>当前状态</span><span class="fault-status fault-status-${fault.status}">${faultStatusText(fault.status)}</span></div>
      <div class="settlement-row"><span>上报人</span><strong>${fault.reported_by}</strong></div>
      <div class="settlement-row"><span>上报时间</span><strong>${fmtDT(fault.created_at)}</strong></div>
      <div class="settlement-row"><span>解决时间</span><strong>${fault.resolved_at ? fmtDT(fault.resolved_at) : '-'}</strong></div>
    </div>
    <div class="form-group">
      <div class="form-label">故障标题</div>
      <div style="padding:10px 12px;background:var(--bg);border-radius:8px"><strong>${fault.title}</strong></div>
    </div>
    <div class="form-group">
      <div class="form-label">详细描述</div>
      <div style="padding:10px 12px;background:var(--bg);border-radius:8px;white-space:pre-wrap">${fault.description || '无详细描述'}</div>
    </div>
    ${repairHtml}
  `, `故障详情 #${fault.id}`, true);
}

// ==================== 巡检台账 ====================

let ledgerFilter = { room_id: '', start_date: '', end_date: '' };

async function renderLedger() {
  setActivePage('ledger', '巡检台账查询');
  roomsCache = await request(`${API}/rooms`) || [];
  const today = new Date().toISOString().split('T')[0];
  if (!ledgerFilter.start_date) {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    ledgerFilter.start_date = d.toISOString().split('T')[0];
  }
  if (!ledgerFilter.end_date) ledgerFilter.end_date = today;
  await renderLedgerList();
}

async function renderLedgerList() {
  let url = `${API}/inspections`;
  const params = [];
  if (ledgerFilter.room_id) params.push(`room_id=${ledgerFilter.room_id}`);
  if (ledgerFilter.start_date) params.push(`start_date=${ledgerFilter.start_date}`);
  if (ledgerFilter.end_date) params.push(`end_date=${ledgerFilter.end_date}`);
  if (params.length) url += '?' + params.join('&');

  const list = await request(url);
  if (!list) return;

  const totalCount = list.length;
  const totalFaults = list.reduce((s, r) => s + (r.fault_count || 0), 0);
  const totalWarnings = list.reduce((s, r) => s + (r.warning_count || 0), 0);
  const normalCount = list.filter(r => !r.fault_count && !r.warning_count).length;

  document.getElementById('pageContent').innerHTML = `
    <div class="filter-bar">
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">包间筛选</label>
        <select class="form-select" onchange="ledgerFilter.room_id=this.value;renderLedgerList()">
          <option value="">全部包间</option>
          ${roomsCache.map(r => `<option value="${r.id}" ${ledgerFilter.room_id==r.id?'selected':''}>${r.name}</option>`).join('')}
        </select>
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">开始日期</label>
        <input class="form-input" type="date" value="${ledgerFilter.start_date}"
               onchange="ledgerFilter.start_date=this.value;renderLedgerList()">
      </div>
      <div class="form-group" style="margin-bottom:0">
        <label class="form-label">结束日期</label>
        <input class="form-input" type="date" value="${ledgerFilter.end_date}"
               onchange="ledgerFilter.end_date=this.value;renderLedgerList()">
      </div>
      <div style="margin-left:auto">
        <button class="btn btn-outline" onclick="ledgerFilter={room_id:'',start_date:'',end_date:''};renderLedger()">重置</button>
        <button class="btn btn-primary" onclick="exportLedger()">📤 导出台账</button>
      </div>
    </div>

    <div class="stats-grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr))">
      <div class="stat-card blue">
        <div class="stat-label">巡检总次数</div>
        <div class="stat-value">${totalCount}<span class="stat-unit">次</span></div>
        <div class="stat-icon">📋</div>
      </div>
      <div class="stat-card green">
        <div class="stat-label">全正常次数</div>
        <div class="stat-value">${normalCount}<span class="stat-unit">次</span></div>
        <div class="stat-icon">✅</div>
      </div>
      <div class="stat-card orange">
        <div class="stat-label">预警总数</div>
        <div class="stat-value">${totalWarnings}<span class="stat-unit">项</span></div>
        <div class="stat-icon">⚠️</div>
      </div>
      <div class="stat-card red">
        <div class="stat-label">故障总数</div>
        <div class="stat-value">${totalFaults}<span class="stat-unit">项</span></div>
        <div class="stat-icon">❌</div>
      </div>
    </div>

    <div class="card">
      ${list.length ? `
        <table class="data-table">
          <thead><tr>
            <th>巡检编号</th><th>时间</th><th>包间</th><th>巡检人</th>
            <th>设备结果</th><th>异常汇总</th><th>备注</th><th>操作</th>
          </tr></thead>
          <tbody>
            ${list.map(r => `<tr>
              <td>#${r.id}</td>
              <td>${fmtDT(r.created_at)}</td>
              <td><strong>${r.room_name}</strong><br><small style="color:var(--text-muted)">${r.room_type}</small></td>
              <td>${r.inspector}</td>
              <td>
                <span style="color:var(--success);font-weight:600">
                  ✅ ${(r.device_results?.length || 0) - (r.fault_count || 0) - (r.warning_count || 0)} 正常
                </span>
                ${r.warning_count ? `<br><span style="color:var(--warning)">⚠️ ${r.warning_count} 预警</span>` : ''}
                ${r.fault_count ? `<br><span style="color:var(--danger)">❌ ${r.fault_count} 故障</span>` : ''}
              </td>
              <td>
                ${(r.device_results || []).filter(it => it.status !== 'normal').map(it => `
                  <div><span style="font-size:14px">${it.device_icon}</span> ${it.device_type}:
                    <span class="device-status device-status-${it.status}">${deviceStatusText(it.status)}</span>
                  </div>
                `).join('') || '<span style="color:var(--text-muted)">-</span>'}
              </td>
              <td style="max-width:180px">${r.remark || '-'}</td>
              <td>
                <button class="btn btn-sm btn-outline" onclick="showInspectionDetail(${r.id})">查看详情</button>
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      ` : '<div class="empty-state"><div class="empty-state-icon">📖</div>暂无巡检记录</div>'}
    </div>
  `;
}

async function exportLedger() {
  let url = `${API}/inspections`;
  const params = [];
  if (ledgerFilter.room_id) params.push(`room_id=${ledgerFilter.room_id}`);
  if (ledgerFilter.start_date) params.push(`start_date=${ledgerFilter.start_date}`);
  if (ledgerFilter.end_date) params.push(`end_date=${ledgerFilter.end_date}`);
  if (params.length) url += '?' + params.join('&');

  const list = await request(url);
  if (!list || !list.length) {
    showToast('暂无可导出的数据', 'warning');
    return;
  }

  let csv = '\uFEFF编号,时间,包间,巡检人,设备数,正常,预警,故障,异常设备,备注\n';
  list.forEach(r => {
    const devs = r.device_results || [];
    const normal = devs.length - (r.fault_count || 0) - (r.warning_count || 0);
    const abn = devs.filter(it => it.status !== 'normal').map(it => `${it.device_type}:${deviceStatusText(it.status)}${it.note ? '('+it.note+')' : ''}`).join('；');
    csv += [
      r.id,
      fmtDT(r.created_at),
      r.room_name,
      r.inspector,
      devs.length,
      normal,
      r.warning_count || 0,
      r.fault_count || 0,
      `"${abn || ''}"`,
      `"${(r.remark || '').replace(/"/g, '""')}"`
    ].join(',') + '\n';
  });

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `巡检台账_${ledgerFilter.start_date || 'all'}_${ledgerFilter.end_date || 'all'}.csv`;
  a.click();
  showToast('台账已导出', 'success');
}

// ==================== 路由 ====================

function renderPage(page) {
  switch (page) {
    case 'dashboard': return renderDashboard();
    case 'rooms': return renderRooms();
    case 'movies': return renderMovies();
    case 'reservations': return renderReservations();
    case 'checkin': return renderCheckin();
    case 'checkout': return renderCheckout();
    case 'transactions': return renderTransactions();
    case 'inspection': return renderInspectionDashboard();
    case 'devices': return renderDevices();
    case 'inspection-register': return renderInspectionRegister();
    case 'faults': return renderFaults();
    case 'ledger': return renderLedger();
    default: return renderDashboard();
  }
}

// ==================== 启动 ====================

updateTime();
setInterval(updateTime, 1000);
renderDashboard();
