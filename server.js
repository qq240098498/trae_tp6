const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const { load, save, nextId } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

function generateCheckinCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function withRelated(r) {
  const d = load();
  const room = d.rooms.find(x => x.id === r.room_id);
  const movie = r.movie_id ? d.movies.find(x => x.id === r.movie_id) : null;
  return {
    ...r,
    room_name: room?.name,
    room_type: room?.type,
    room_price: room?.price_per_hour,
    movie_title: movie?.title,
    movie_duration: movie?.duration,
    customer_name: r.customer_name
  };
}

// ==================== 包间管理 ====================

app.get('/api/rooms', (req, res) => {
  const { status } = req.query;
  const d = load();
  let rooms = [...d.rooms].sort((a, b) => a.name.localeCompare(b.name));
  if (status) {
    rooms = rooms.filter(r => r.status === status);
  }

  const now = new Date();
  const result = rooms.map(room => {
    const activeResv = d.reservations
      .filter(r => r.room_id === room.id && 
                   ['booked', 'checked_in'].includes(r.status) &&
                   new Date(r.end_time) > now)
      .sort((a, b) => new Date(a.start_time) - new Date(b.start_time))
      .slice(0, 1)
      .map(r => {
        const movie = r.movie_id ? d.movies.find(m => m.id === r.movie_id) : null;
        return { ...r, movie_title: movie?.title || null };
      })[0] || null;

    const pendingFaults = d.faults.filter(f =>
      f.room_id === room.id && !['resolved', 'closed'].includes(f.status)
    );
    const warningDevices = d.devices.filter(dv => dv.room_id === room.id && dv.status === 'warning');

    return {
      ...room,
      active_reservation: activeResv,
      pending_fault_count: pendingFaults.length,
      pending_fault_level: pendingFaults.some(f => f.level === 'high') ? 'high' :
                           pendingFaults.some(f => f.level === 'medium') ? 'medium' :
                           pendingFaults.some(f => f.level === 'low') ? 'low' : null,
      warning_device_count: warningDevices.length
    };
  });

  res.json({ success: true, data: result });
});

app.get('/api/rooms/:id', (req, res) => {
  const d = load();
  const room = d.rooms.find(r => r.id === parseInt(req.params.id));
  if (!room) return res.status(404).json({ success: false, message: '包间不存在' });

  const now = new Date();
  const futureResvs = d.reservations
    .filter(r => r.room_id === room.id &&
                 ['booked', 'checked_in'].includes(r.status) &&
                 new Date(r.end_time) > now)
    .sort((a, b) => new Date(a.start_time) - new Date(b.start_time))
    .map(r => {
      const movie = r.movie_id ? d.movies.find(m => m.id === r.movie_id) : null;
      return { ...r, movie_title: movie?.title || null };
    });

  res.json({ success: true, data: { ...room, reservations: futureResvs } });
});

app.put('/api/rooms/:id/status', (req, res) => {
  const { status } = req.body;
  const validStatuses = ['idle', 'occupied', 'maintenance'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ success: false, message: '无效状态' });
  }
  const d = load();
  const idx = d.rooms.findIndex(r => r.id === parseInt(req.params.id));
  if (idx === -1) {
    return res.status(404).json({ success: false, message: '包间不存在' });
  }
  d.rooms[idx].status = status;
  save();
  res.json({ success: true, message: '状态更新成功' });
});

// ==================== 影片分类管理 ====================

app.get('/api/categories', (req, res) => {
  const d = load();
  const categories = d.movie_categories.map(c => ({
    ...c,
    movie_count: d.movies.filter(m => m.category_id === c.id).length
  })).sort((a, b) => a.name.localeCompare(b.name));
  res.json({ success: true, data: categories });
});

app.post('/api/categories', (req, res) => {
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ success: false, message: '分类名不能为空' });
  const d = load();
  if (d.movie_categories.some(c => c.name === name)) {
    return res.status(400).json({ success: false, message: '分类已存在' });
  }
  const id = nextId('movie_categories');
  const cat = { id, name, description: description || '', created_at: new Date().toISOString() };
  d.movie_categories.push(cat);
  save();
  res.json({ success: true, data: cat });
});

// ==================== 影片管理 ====================

app.get('/api/movies', (req, res) => {
  const { category_id, keyword } = req.query;
  const d = load();
  let movies = [...d.movies];

  if (category_id) {
    const cid = parseInt(category_id);
    movies = movies.filter(m => m.category_id === cid);
  }
  if (keyword) {
    const kw = String(keyword).toLowerCase();
    movies = movies.filter(m =>
      m.title.toLowerCase().includes(kw) ||
      (m.description && m.description.toLowerCase().includes(kw))
    );
  }

  const result = movies.map(m => {
    const cat = d.movie_categories.find(c => c.id === m.category_id);
    return { ...m, category_name: cat?.name || null };
  }).sort((a, b) => (b.rating - a.rating) || (new Date(b.created_at) - new Date(a.created_at)));

  res.json({ success: true, data: result });
});

app.get('/api/movies/:id', (req, res) => {
  const d = load();
  const movie = d.movies.find(m => m.id === parseInt(req.params.id));
  if (!movie) return res.status(404).json({ success: false, message: '影片不存在' });
  const cat = d.movie_categories.find(c => c.id === movie.category_id);
  res.json({ success: true, data: { ...movie, category_name: cat?.name || null } });
});

app.post('/api/movies', (req, res) => {
  const { title, category_id, duration, rating, description, release_year } = req.body;
  if (!title || !duration) {
    return res.status(400).json({ success: false, message: '标题和时长必填' });
  }
  const d = load();
  const id = nextId('movies');
  const movie = {
    id,
    title,
    category_id: category_id ? parseInt(category_id) : null,
    duration: parseInt(duration),
    rating: parseFloat(rating) || 0,
    description: description || '',
    release_year: release_year ? parseInt(release_year) : null,
    poster_url: null,
    created_at: new Date().toISOString()
  };
  d.movies.push(movie);
  save();
  res.json({ success: true, data: movie });
});

// ==================== 预约管理 ====================

app.get('/api/reservations', (req, res) => {
  const { status, date, room_id } = req.query;
  const d = load();
  let reservations = [...d.reservations];

  if (status) {
    reservations = reservations.filter(r => r.status === status);
  }
  if (date) {
    reservations = reservations.filter(r => {
      const s = new Date(r.start_time);
      const ds = new Date(date);
      return s.getFullYear() === ds.getFullYear() &&
             s.getMonth() === ds.getMonth() &&
             s.getDate() === ds.getDate();
    });
  }
  if (room_id) {
    reservations = reservations.filter(r => r.room_id === parseInt(room_id));
  }

  const result = reservations
    .sort((a, b) => new Date(b.start_time) - new Date(a.start_time))
    .map(withRelated);

  res.json({ success: true, data: result });
});

app.post('/api/reservations', (req, res) => {
  const {
    room_id, movie_id, customer_name, customer_phone,
    start_time, end_time, remark
  } = req.body;

  if (!room_id || !customer_name || !customer_phone || !start_time || !end_time) {
    return res.status(400).json({ success: false, message: '缺少必要字段' });
  }

  const start = new Date(start_time);
  const end = new Date(end_time);
  if (end <= start) {
    return res.status(400).json({ success: false, message: '结束时间必须晚于开始时间' });
  }

  const d = load();
  const roomId = parseInt(room_id);

  const conflict = d.reservations.find(r => {
    if (r.room_id !== roomId) return false;
    if (!['booked', 'checked_in'].includes(r.status)) return false;
    const rs = new Date(r.start_time);
    const re = new Date(r.end_time);
    return (start < re && end > rs);
  });

  if (conflict) {
    return res.status(400).json({ success: false, message: '该时间段包间已被预约' });
  }

  const room = d.rooms.find(r => r.id === roomId);
  if (!room) return res.status(404).json({ success: false, message: '包间不存在' });

  const pendingFaults = d.faults.filter(f =>
    f.room_id === roomId && !['resolved', 'closed'].includes(f.status)
  );

  if (pendingFaults.length > 0) {
    const highCount = pendingFaults.filter(f => f.level === 'high').length;
    const medCount = pendingFaults.filter(f => f.level === 'medium').length;
    const lowCount = pendingFaults.filter(f => f.level === 'low').length;
    const levelDesc = [
      highCount ? `高${highCount}` : null,
      medCount ? `中${medCount}` : null,
      lowCount ? `低${lowCount}` : null
    ].filter(Boolean).join('/');
    return res.status(400).json({
      success: false,
      message: `该包间当前存在${pendingFaults.length}项未解决设备故障（${levelDesc}级），为确保观影体验，暂不接受预约。请先处理设备故障后再预约。`,
      data: { fault_count: pendingFaults.length }
    });
  }

  if (room.status === 'maintenance') {
    return res.status(400).json({
      success: false,
      message: '该包间当前处于维护中，暂不接受预约，请选择其他包间或稍后再试。'
    });
  }

  if (room.status === 'occupied') {
    return res.status(400).json({ success: false, message: '该包间当前正在使用中，请选择其他时间段或包间' });
  }

  const hours = Math.ceil((end - start) / (1000 * 60 * 60));
  const total_amount = hours * room.price_per_hour;
  const checkin_code = generateCheckinCode();
  const id = nextId('reservations');

  const reservation = {
    id,
    room_id: roomId,
    movie_id: movie_id ? parseInt(movie_id) : null,
    customer_name,
    customer_phone,
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    status: 'booked',
    total_amount,
    paid_amount: 0,
    checkin_code,
    checkin_time: null,
    checkout_time: null,
    remark: remark || '',
    created_at: new Date().toISOString()
  };
  d.reservations.push(reservation);
  save();

  res.json({
    success: true,
    data: { id, checkin_code, total_amount }
  });
});

app.get('/api/reservations/:id', (req, res) => {
  const d = load();
  const r = d.reservations.find(x => x.id === parseInt(req.params.id));
  if (!r) return res.status(404).json({ success: false, message: '预约不存在' });
  const room = d.rooms.find(x => x.id === r.room_id);
  const movie = r.movie_id ? d.movies.find(x => x.id === r.movie_id) : null;
  const transactions = d.transactions
    .filter(t => t.reservation_id === r.id)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  res.json({
    success: true,
    data: {
      ...r,
      room_name: room?.name,
      room_type: room?.type,
      price_per_hour: room?.price_per_hour,
      movie_title: movie?.title,
      movie_duration: movie?.duration,
      transactions
    }
  });
});

// ==================== 到店核验 ====================

app.post('/api/checkin', (req, res) => {
  const { checkin_code, reservation_id } = req.body;
  const d = load();

  let reservation;
  if (checkin_code) {
    reservation = d.reservations.find(r => r.checkin_code === checkin_code);
  } else if (reservation_id) {
    reservation = d.reservations.find(r => r.id === parseInt(reservation_id));
  }

  if (!reservation) {
    return res.status(404).json({ success: false, message: '预约信息不存在' });
  }
  if (reservation.status === 'checked_in') {
    return res.status(400).json({ success: false, message: '已办理入住' });
  }
  if (reservation.status === 'completed' || reservation.status === 'cancelled') {
    return res.status(400).json({ success: false, message: '预约已完成或已取消' });
  }

  const now = new Date();
  const startTime = new Date(reservation.start_time);
  if (now < new Date(startTime.getTime() - 30 * 60 * 1000)) {
    return res.status(400).json({ success: false, message: '尚未到提前30分钟的入场时间' });
  }

  reservation.status = 'checked_in';
  reservation.checkin_time = now.toISOString();

  const room = d.rooms.find(r => r.id === reservation.room_id);
  if (room) room.status = 'occupied';
  save();

  res.json({ success: true, message: '核验成功，欢迎光临', data: { id: reservation.id } });
});

// ==================== 消费结算 ====================

app.post('/api/checkout/:id', (req, res) => {
  const { payment_method, extra_charge, remark } = req.body;
  const d = load();
  const reservation = d.reservations.find(r => r.id === parseInt(req.params.id));

  if (!reservation) return res.status(404).json({ success: false, message: '预约不存在' });
  if (reservation.status === 'completed' || reservation.status === 'cancelled') {
    return res.status(400).json({ success: false, message: '订单已结算或已取消' });
  }

  const room = d.rooms.find(r => r.id === reservation.room_id);
  if (!room) return res.status(400).json({ success: false, message: '包间数据异常' });

  const now = new Date();
  const startTime = reservation.checkin_time
    ? new Date(reservation.checkin_time)
    : new Date(reservation.start_time);

  const actualHours = Math.max(1, Math.ceil((now - startTime) / (1000 * 60 * 60)));
  const actualBaseAmount = actualHours * room.price_per_hour;
  const bookedAmount = reservation.total_amount || 0;
  const extra = extra_charge ? parseFloat(extra_charge) : 0;

  const baseAmount = Math.max(actualBaseAmount, bookedAmount);
  const discount = (bookedAmount > 0 && bookedAmount < actualBaseAmount) ? (actualBaseAmount - bookedAmount) : 0;
  const finalAmount = baseAmount + extra - discount;
  const unpaid = finalAmount - (reservation.paid_amount || 0);

  if (unpaid > 0) {
    const txId = nextId('transactions');
    d.transactions.push({
      id: txId,
      reservation_id: reservation.id,
      type: 'payment',
      amount: Math.max(0, unpaid),
      payment_method: payment_method || 'cash',
      remark: remark || '',
      created_at: now.toISOString()
    });
  }

  reservation.status = 'completed';
  reservation.checkout_time = now.toISOString();
  reservation.paid_amount = (reservation.paid_amount || 0) + Math.max(0, unpaid);
  reservation.total_amount = finalAmount;
  if (remark) reservation.remark = remark;

  room.status = 'idle';
  save();

  res.json({
    success: true,
    message: '结算完成',
    data: {
      id: reservation.id,
      actual_hours: actualHours,
      actual_base_amount: actualBaseAmount,
      booked_amount: bookedAmount,
      base_amount: baseAmount,
      extra_charge: extra,
      discount: discount,
      final_amount: finalAmount,
      already_paid: reservation.paid_amount || 0,
      paid_amount: Math.max(0, unpaid),
      unpaid_amount: Math.max(0, unpaid)
    }
  });
});

app.post('/api/reservations/:id/cancel', (req, res) => {
  const d = load();
  const reservation = d.reservations.find(r => r.id === parseInt(req.params.id));
  if (!reservation) return res.status(404).json({ success: false, message: '预约不存在' });
  if (reservation.status === 'checked_in') {
    return res.status(400).json({ success: false, message: '已入住，不可取消，请办理结算' });
  }
  if (reservation.status !== 'booked') {
    return res.status(400).json({ success: false, message: '当前状态不可取消' });
  }
  reservation.status = 'cancelled';
  save();
  res.json({ success: true, message: '预约已取消' });
});

// ==================== 交易记录 ====================

app.get('/api/transactions', (req, res) => {
  const { date, type } = req.query;
  const d = load();
  let transactions = [...d.transactions];

  if (date) {
    transactions = transactions.filter(t => {
      const td = new Date(t.created_at);
      const ds = new Date(date);
      return td.getFullYear() === ds.getFullYear() &&
             td.getMonth() === ds.getMonth() &&
             td.getDate() === ds.getDate();
    });
  }
  if (type) {
    transactions = transactions.filter(t => t.type === type);
  }

  const result = transactions
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 200)
    .map(t => {
      const r = d.reservations.find(x => x.id === t.reservation_id);
      const room = r ? d.rooms.find(x => x.id === r.room_id) : null;
      return {
        ...t,
        customer_name: r?.customer_name,
        room_name: room?.name
      };
    });

  res.json({ success: true, data: result });
});

// ==================== 统计数据 ====================

app.get('/api/stats/dashboard', (req, res) => {
  const d = load();
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const todayEnd = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000);

  const roomStats = {};
  d.rooms.forEach(r => {
    roomStats[r.status] = (roomStats[r.status] || 0) + 1;
  });
  const roomStatsArr = Object.entries(roomStats).map(([status, count]) => ({ status, count }));

  const todayResvs = d.reservations.filter(r => {
    const s = new Date(r.start_time);
    return s >= todayStart && s < todayEnd;
  });

  const reservationCounts = {
    total: todayResvs.length,
    booked: todayResvs.filter(r => r.status === 'booked').length,
    checked_in: todayResvs.filter(r => r.status === 'checked_in').length,
    completed: todayResvs.filter(r => r.status === 'completed').length,
    cancelled: todayResvs.filter(r => r.status === 'cancelled').length
  };

  const todayRevenue = d.transactions
    .filter(t => {
      const c = new Date(t.created_at);
      return c >= todayStart && c < todayEnd && t.type === 'payment';
    })
    .reduce((s, t) => s + t.amount, 0);

  const upcoming = d.reservations
    .filter(r => r.status === 'booked' && new Date(r.start_time) >= new Date())
    .sort((a, b) => new Date(a.start_time) - new Date(b.start_time))
    .slice(0, 10)
    .map(r => {
      const room = d.rooms.find(x => x.id === r.room_id);
      const movie = r.movie_id ? d.movies.find(x => x.id === r.movie_id) : null;
      return {
        ...r,
        room_name: room?.name,
        movie_title: movie?.title
      };
    });

  res.json({
    success: true,
    data: {
      room_stats: roomStatsArr,
      today_reservations: reservationCounts,
      today_revenue: todayRevenue,
      upcoming_reservations: upcoming
    }
  });
});

// ==================== 设备管理 ====================

app.get('/api/devices', (req, res) => {
  const { room_id, status, type } = req.query;
  const d = load();
  let devices = [...d.devices];

  if (room_id) {
    devices = devices.filter(x => x.room_id === parseInt(room_id));
  }
  if (status) {
    devices = devices.filter(x => x.status === status);
  }
  if (type) {
    devices = devices.filter(x => x.type === type);
  }

  const result = devices.map(dev => {
    const room = d.rooms.find(r => r.id === dev.room_id);
    const faultCount = d.faults.filter(f => f.device_id === dev.id && f.status !== 'resolved').length;
    return {
      ...dev,
      room_name: room?.name,
      room_type: room?.type,
      active_fault_count: faultCount
    };
  }).sort((a, b) => a.room_name?.localeCompare(b.room_name || '') || a.id - b.id);

  res.json({ success: true, data: result });
});

app.get('/api/devices/:id', (req, res) => {
  const d = load();
  const dev = d.devices.find(x => x.id === parseInt(req.params.id));
  if (!dev) return res.status(404).json({ success: false, message: '设备不存在' });

  const room = d.rooms.find(r => r.id === dev.room_id);
  const inspections = d.inspections
    .filter(i => i.items?.some(it => it.device_id === dev.id))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 10);
  const faults = d.faults
    .filter(f => f.device_id === dev.id)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

  res.json({
    success: true,
    data: {
      ...dev,
      room_name: room?.name,
      room_type: room?.type,
      recent_inspections: inspections,
      fault_history: faults
    }
  });
});

app.post('/api/devices', (req, res) => {
  const { room_id, name, type, type_name, icon, brand, model, purchase_date, remark } = req.body;
  if (!room_id || !name || !type) {
    return res.status(400).json({ success: false, message: '缺少必要字段' });
  }
  const d = load();
  const room = d.rooms.find(r => r.id === parseInt(room_id));
  if (!room) return res.status(404).json({ success: false, message: '包间不存在' });

  const id = nextId('devices');
  const device = {
    id,
    room_id: parseInt(room_id),
    name,
    type,
    type_name: type_name || name,
    icon: icon || '🔧',
    brand: brand || '',
    model: model || '',
    purchase_date: purchase_date || new Date().toISOString().split('T')[0],
    status: 'normal',
    last_inspection: null,
    remark: remark || '',
    created_at: new Date().toISOString()
  };
  d.devices.push(device);
  save();
  res.json({ success: true, data: device });
});

app.put('/api/devices/:id', (req, res) => {
  const d = load();
  const idx = d.devices.findIndex(x => x.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ success: false, message: '设备不存在' });

  d.devices[idx] = { ...d.devices[idx], ...req.body, id: d.devices[idx].id };
  save();
  res.json({ success: true, message: '设备更新成功' });
});

app.put('/api/devices/:id/status', (req, res) => {
  const { status } = req.body;
  const validStatuses = ['normal', 'warning', 'fault', 'maintenance'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ success: false, message: '无效状态' });
  }
  const d = load();
  const idx = d.devices.findIndex(x => x.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ success: false, message: '设备不存在' });

  d.devices[idx].status = status;
  save();
  res.json({ success: true, message: '状态更新成功' });
});

app.delete('/api/devices/:id', (req, res) => {
  const d = load();
  const idx = d.devices.findIndex(x => x.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ success: false, message: '设备不存在' });

  d.devices.splice(idx, 1);
  save();
  res.json({ success: true, message: '设备已删除' });
});

// ==================== 巡检记录 ====================

app.get('/api/inspections', (req, res) => {
  const { room_id, start_date, end_date, inspector } = req.query;
  const d = load();
  let inspections = [...d.inspections];

  if (room_id) {
    const rid = parseInt(room_id);
    inspections = inspections.filter(i => i.room_id === rid);
  }
  if (start_date) {
    const sd = new Date(start_date);
    inspections = inspections.filter(i => new Date(i.created_at) >= sd);
  }
  if (end_date) {
    const ed = new Date(end_date);
    ed.setDate(ed.getDate() + 1);
    inspections = inspections.filter(i => new Date(i.created_at) < ed);
  }
  if (inspector) {
    inspections = inspections.filter(i => i.inspector?.includes(inspector));
  }

  const result = inspections
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .map(ins => {
      const room = d.rooms.find(r => r.id === ins.room_id);
      const deviceResults = ins.items?.map(it => {
        const dev = d.devices.find(dv => dv.id === it.device_id);
        return { ...it, device_name: dev?.name, device_type: dev?.type_name, device_icon: dev?.icon };
      }) || [];
      const faultCount = deviceResults.filter(r => r.status === 'fault').length;
      const warningCount = deviceResults.filter(r => r.status === 'warning').length;
      return {
        ...ins,
        room_name: room?.name,
        room_type: room?.type,
        device_results: deviceResults,
        fault_count: faultCount,
        warning_count: warningCount
      };
    });

  res.json({ success: true, data: result });
});

app.post('/api/inspections', (req, res) => {
  const { room_id, inspector, items, remark } = req.body;
  if (!room_id || !inspector || !items || !items.length) {
    return res.status(400).json({ success: false, message: '缺少必要字段' });
  }

  const d = load();
  const room = d.rooms.find(r => r.id === parseInt(room_id));
  if (!room) return res.status(404).json({ success: false, message: '包间不存在' });

  const id = nextId('inspections');
  const now = new Date().toISOString();
  const inspection = {
    id,
    room_id: parseInt(room_id),
    inspector,
    items,
    remark: remark || '',
    created_at: now
  };
  d.inspections.push(inspection);

  const faultItems = items.filter(it => it.status === 'fault');
  const faultIds = [];
  faultItems.forEach(it => {
    const fid = nextId('faults');
    const dev = d.devices.find(dv => dv.id === it.device_id);
    d.faults.push({
      id: fid,
      device_id: it.device_id,
      inspection_id: id,
      room_id: parseInt(room_id),
      title: `${dev?.name || '设备'}故障`,
      description: it.note || '巡检发现故障',
      level: it.fault_level || 'medium',
      reported_by: inspector,
      status: 'pending',
      created_at: now,
      resolved_at: null
    });
    faultIds.push(fid);
    if (dev) dev.status = 'fault';
  });

  items.forEach(it => {
    const dev = d.devices.find(dv => dv.id === it.device_id);
    if (dev) {
      dev.last_inspection = now;
      if (it.status === 'warning' && dev.status === 'normal') dev.status = 'warning';
      if (it.status === 'normal' && dev.status === 'warning') dev.status = 'normal';
    }
  });

  if (faultItems.length && room.status === 'idle') {
    room.status = 'maintenance';
  }

  save();
  refreshRoomStatus(parseInt(room_id));
  res.json({ success: true, data: { id, fault_ids: faultIds, room_locked: faultItems.length > 0 } });
});

app.get('/api/inspections/:id', (req, res) => {
  const d = load();
  const ins = d.inspections.find(x => x.id === parseInt(req.params.id));
  if (!ins) return res.status(404).json({ success: false, message: '巡检记录不存在' });

  const room = d.rooms.find(r => r.id === ins.room_id);
  const deviceResults = ins.items?.map(it => {
    const dev = d.devices.find(dv => dv.id === it.device_id);
    return { ...it, device_name: dev?.name, device_type: dev?.type_name, device_icon: dev?.icon };
  }) || [];
  const relatedFaults = d.faults.filter(f => f.inspection_id === ins.id);

  res.json({
    success: true,
    data: {
      ...ins,
      room_name: room?.name,
      device_results: deviceResults,
      related_faults: relatedFaults
    }
  });
});

// ==================== 故障管理 ====================

app.get('/api/faults', (req, res) => {
  const { room_id, device_id, status, level } = req.query;
  const d = load();
  let faults = [...d.faults];

  if (room_id) faults = faults.filter(f => f.room_id === parseInt(room_id));
  if (device_id) faults = faults.filter(f => f.device_id === parseInt(device_id));
  if (status) faults = faults.filter(f => f.status === status);
  if (level) faults = faults.filter(f => f.level === level);

  const result = faults
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .map(f => {
      const dev = d.devices.find(dv => dv.id === f.device_id);
      const room = d.rooms.find(r => r.id === f.room_id);
      const repair = d.repairs.find(r => r.fault_id === f.id);
      return {
        ...f,
        device_name: dev?.name,
        device_type: dev?.type_name,
        device_icon: dev?.icon,
        room_name: room?.name,
        repair_info: repair ? { id: repair.id, status: repair.status, repairer: repair.repairer } : null
      };
    });

  res.json({ success: true, data: result });
});

app.post('/api/faults', (req, res) => {
  const { device_id, room_id, title, description, level, reported_by } = req.body;
  if (!device_id || !title) {
    return res.status(400).json({ success: false, message: '缺少必要字段' });
  }

  const d = load();
  const dev = d.devices.find(dv => dv.id === parseInt(device_id));
  if (!dev) return res.status(404).json({ success: false, message: '设备不存在' });

  const rid = room_id ? parseInt(room_id) : dev.room_id;
  const id = nextId('faults');
  const now = new Date().toISOString();
  const fault = {
    id,
    device_id: parseInt(device_id),
    room_id: rid,
    inspection_id: null,
    title,
    description: description || '',
    level: level || 'medium',
    reported_by: reported_by || '系统',
    status: 'pending',
    created_at: now,
    resolved_at: null
  };
  d.faults.push(fault);
  dev.status = 'fault';

  const room = d.rooms.find(r => r.id === rid);
  if (room && room.status === 'idle') {
    room.status = 'maintenance';
  }

  save();
  refreshRoomStatus(rid);
  res.json({ success: true, data: fault });
});

app.put('/api/faults/:id', (req, res) => {
  const d = load();
  const idx = d.faults.findIndex(x => x.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ success: false, message: '故障记录不存在' });

  d.faults[idx] = { ...d.faults[idx], ...req.body, id: d.faults[idx].id };
  save();
  res.json({ success: true, message: '故障记录已更新' });
});

app.put('/api/faults/:id/status', (req, res) => {
  const { status } = req.body;
  const validStatuses = ['pending', 'processing', 'resolved', 'closed'];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ success: false, message: '无效状态' });
  }
  const d = load();
  const idx = d.faults.findIndex(x => x.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ success: false, message: '故障记录不存在' });

  d.faults[idx].status = status;
  if (['resolved', 'closed'].includes(status)) {
    d.faults[idx].resolved_at = d.faults[idx].resolved_at || new Date().toISOString();
    const dev = d.devices.find(dv => dv.id === d.faults[idx].device_id);
    if (dev && dev.status === 'fault') {
      const hasOtherFault = d.faults.some(f => f.device_id === dev.id && f.id !== d.faults[idx].id && !['resolved', 'closed'].includes(f.status));
      if (!hasOtherFault) dev.status = 'normal';
    }
    const room = d.rooms.find(r => r.id === d.faults[idx].room_id);
    if (room && room.status === 'maintenance') {
      const hasRoomFault = d.faults.some(f => f.room_id === room.id && !['resolved', 'closed'].includes(f.status));
      if (!hasRoomFault) room.status = 'idle';
    }
  }
  save();
  refreshRoomStatus(d.faults[idx].room_id);
  res.json({ success: true, message: '状态更新成功' });
});

// ==================== 维修记录 ====================

app.get('/api/repairs', (req, res) => {
  const { room_id, status, repairer } = req.query;
  const d = load();
  let repairs = [...d.repairs];

  if (room_id) {
    const rid = parseInt(room_id);
    repairs = repairs.filter(r => {
      const fault = d.faults.find(f => f.id === r.fault_id);
      return fault?.room_id === rid;
    });
  }
  if (status) repairs = repairs.filter(r => r.status === status);
  if (repairer) repairs = repairs.filter(r => r.repairer?.includes(repairer));

  const result = repairs
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .map(r => {
      const fault = d.faults.find(f => f.id === r.fault_id);
      const dev = d.devices.find(dv => dv.id === fault?.device_id);
      const room = d.rooms.find(rm => rm.id === fault?.room_id);
      return {
        ...r,
        fault_title: fault?.title,
        fault_description: fault?.description,
        fault_level: fault?.level,
        device_name: dev?.name,
        device_type: dev?.type_name,
        device_icon: dev?.icon,
        room_name: room?.name
      };
    });

  res.json({ success: true, data: result });
});

app.post('/api/repairs', (req, res) => {
  const { fault_id, repairer, repair_method, parts_used, cost, repair_note } = req.body;
  if (!fault_id || !repairer || !repair_method) {
    return res.status(400).json({ success: false, message: '缺少必要字段' });
  }

  const d = load();
  const faultIdx = d.faults.findIndex(f => f.id === parseInt(fault_id));
  if (faultIdx === -1) return res.status(404).json({ success: false, message: '故障记录不存在' });

  const id = nextId('repairs');
  const now = new Date().toISOString();
  const repair = {
    id,
    fault_id: parseInt(fault_id),
    repairer,
    repair_method,
    parts_used: parts_used || '',
    cost: cost ? parseFloat(cost) : 0,
    repair_note: repair_note || '',
    status: 'completed',
    created_at: now
  };
  d.repairs.push(repair);

  d.faults[faultIdx].status = 'resolved';
  d.faults[faultIdx].resolved_at = now;

  const dev = d.devices.find(dv => dv.id === d.faults[faultIdx].device_id);
  if (dev && dev.status === 'fault') {
    const hasOtherFault = d.faults.some(f => f.device_id === dev.id && f.id !== d.faults[faultIdx].id && !['resolved', 'closed'].includes(f.status));
    if (!hasOtherFault) dev.status = 'normal';
  }

  const room = d.rooms.find(r => r.id === d.faults[faultIdx].room_id);
  if (room && room.status === 'maintenance') {
    const hasRoomFault = d.faults.some(f => f.room_id === room.id && f.id !== d.faults[faultIdx].id && !['resolved', 'closed'].includes(f.status));
    if (!hasRoomFault) room.status = 'idle';
  }

  save();
  refreshRoomStatus(d.faults[faultIdx].room_id);
  res.json({ success: true, data: repair });
});

// ==================== 巡检统计 ====================

app.get('/api/stats/inspection', (req, res) => {
  const d = load();
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  const todayInspections = d.inspections.filter(i => new Date(i.created_at) >= todayStart);
  const pendingFaults = d.faults.filter(f => !['resolved', 'closed'].includes(f.status));
  const processingFaults = d.faults.filter(f => f.status === 'processing');
  const totalRepairCost = d.repairs.reduce((s, r) => s + (r.cost || 0), 0);
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthRepairCost = d.repairs
    .filter(r => new Date(r.created_at) >= monthStart)
    .reduce((s, r) => s + (r.cost || 0), 0);

  const deviceStatusStats = {};
  d.devices.forEach(dev => {
    deviceStatusStats[dev.status] = (deviceStatusStats[dev.status] || 0) + 1;
  });

  const roomStats = d.rooms.map(r => {
    const devs = d.devices.filter(dv => dv.room_id === r.id);
    const normalCount = devs.filter(dv => dv.status === 'normal').length;
    const faultCount = devs.filter(dv => dv.status === 'fault').length;
    const warnCount = devs.filter(dv => dv.status === 'warning').length;
    const recentInspection = d.inspections
      .filter(i => i.room_id === r.id)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
    return {
      room_id: r.id,
      room_name: r.name,
      total_devices: devs.length,
      normal_count: normalCount,
      fault_count: faultCount,
      warning_count: warnCount,
      last_inspection: recentInspection?.created_at || null,
      inspector: recentInspection?.inspector || null
    };
  });

  res.json({
    success: true,
    data: {
      today_inspection_count: todayInspections.length,
      total_inspections: d.inspections.length,
      pending_faults: pendingFaults.length,
      processing_faults: processingFaults.length,
      total_devices: d.devices.length,
      normal_devices: deviceStatusStats.normal || 0,
      warning_devices: deviceStatusStats.warning || 0,
      fault_devices: deviceStatusStats.fault || 0,
      maintenance_devices: deviceStatusStats.maintenance || 0,
      total_repair_cost: totalRepairCost,
      month_repair_cost: monthRepairCost,
      room_stats: roomStats
    }
  });
});

// ==================== 辅助函数：包间状态自动联动 ====================

function refreshRoomStatus(roomId) {
  const d = load();
  const idx = d.rooms.findIndex(r => r.id === roomId);
  if (idx === -1) return;
  const room = d.rooms[idx];

  const pendingFaults = d.faults.filter(f =>
    f.room_id === roomId && !['resolved', 'closed'].includes(f.status)
  );

  const isOccupied = d.reservations.some(r =>
    r.room_id === roomId && r.status === 'checked_in' && new Date(r.end_time) > new Date()
  );
  if (isOccupied) return;

  if (pendingFaults.length > 0 && room.status === 'idle') {
    d.rooms[idx].status = 'maintenance';
    save();
    return;
  }
  if (pendingFaults.length === 0 && room.status === 'maintenance') {
    d.rooms[idx].status = 'idle';
    save();
    return;
  }
}

// ==================== 启动服务 ====================

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`  🎬 星幕私人影吧运营系统启动成功!`);
  console.log(`  本地访问: http://localhost:${PORT}`);
  console.log(`  局域网访问: http://<你的IP>:${PORT}`);
  console.log(`${'='.repeat(50)}\n`);
});
