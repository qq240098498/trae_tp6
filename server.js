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
    return { ...room, active_reservation: activeResv };
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
