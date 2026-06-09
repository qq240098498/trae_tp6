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
    default: return renderDashboard();
  }
}

// ==================== 启动 ====================

updateTime();
setInterval(updateTime, 1000);
renderDashboard();
