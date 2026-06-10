const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const { load, save, nextId, transaction, roomTransaction, findTimeConflict, countRoomCheckedIn, countOverlappingCheckedIn } = require('./db');

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

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const recentCancelled = d.reservations.filter(r =>
      r.room_id === room.id &&
      r.status === 'cancelled' &&
      r.cancelled_by === 'system' &&
      new Date(r.cancelled_at || 0) > yesterday
    );

    return {
      ...room,
      active_reservation: activeResv,
      pending_fault_count: pendingFaults.length,
      pending_fault_level: pendingFaults.some(f => f.level === 'high') ? 'high' :
                           pendingFaults.some(f => f.level === 'medium') ? 'medium' :
                           pendingFaults.some(f => f.level === 'low') ? 'low' : null,
      warning_device_count: warningDevices.length,
      system_cancelled_24h: recentCancelled.length,
      urgent_attention: pendingFaults.length > 0 && (
        pendingFaults.some(f => f.level === 'high') || recentCancelled.length > 0
      )
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

  const pendingFaults = d.faults.filter(f =>
    f.room_id === room.id && !['resolved', 'closed'].includes(f.status)
  );
  const warningDevices = d.devices.filter(dv => dv.room_id === room.id && dv.status === 'warning');
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const recentCancelled = d.reservations.filter(r =>
    r.room_id === room.id &&
    r.status === 'cancelled' &&
    r.cancelled_by === 'system' &&
    new Date(r.cancelled_at || 0) > yesterday
  );

  res.json({
    success: true,
    data: {
      ...room,
      reservations: futureResvs,
      pending_fault_count: pendingFaults.length,
      pending_fault_level: pendingFaults.some(f => f.level === 'high') ? 'high' :
                           pendingFaults.some(f => f.level === 'medium') ? 'medium' :
                           pendingFaults.some(f => f.level === 'low') ? 'low' : null,
      warning_device_count: warningDevices.length,
      system_cancelled_24h: recentCancelled.length,
      urgent_attention: pendingFaults.length > 0 && (
        pendingFaults.some(f => f.level === 'high') || recentCancelled.length > 0
      )
    }
  });
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

app.post('/api/reservations', async (req, res) => {
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

  const roomId = parseInt(room_id);

  try {
    const result = await roomTransaction(roomId, async (d) => {
      const conflict = findTimeConflict(d, roomId, start, end);
      if (conflict) {
        const conflictStartTime = new Date(conflict.start_time);
        const conflictEndTime = new Date(conflict.end_time);
        return {
          httpStatus: 400,
          success: false,
          message: `该时间段包间已被预约（${conflictStartTime.toLocaleString()} - ${conflictEndTime.toLocaleString()}，客户：${conflict.customer_name}），请选择其他时间段`,
          data: { conflict_id: conflict.id }
        };
      }

      const room = d.rooms.find(r => r.id === roomId);
      if (!room) {
        return { httpStatus: 404, success: false, message: '包间不存在' };
      }

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
        return {
          httpStatus: 400,
          success: false,
          message: `该包间当前存在${pendingFaults.length}项未解决设备故障（${levelDesc}级），为确保观影体验，暂不接受预约。请先处理设备故障后再预约。`,
          data: { fault_count: pendingFaults.length }
        };
      }

      if (room.status === 'maintenance') {
        return {
          httpStatus: 400,
          success: false,
          message: '该包间当前处于维护中，暂不接受预约，请选择其他包间或稍后再试。'
        };
      }

      if (room.status === 'occupied') {
        const activeCheckin = countRoomCheckedIn(d, roomId);
        if (activeCheckin > 0) {
          return {
            httpStatus: 400,
            success: false,
            message: `该包间当前有${activeCheckin}个场次正在使用中，请选择其他时间段或包间`
          };
        }
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

      return {
        httpStatus: 200,
        success: true,
        data: { id, checkin_code, total_amount }
      };
    });

    res.status(result.httpStatus || 200).json({
      success: result.success,
      message: result.message,
      data: result.data
    });
  } catch (err) {
    console.error('创建预约异常:', err);
    res.status(500).json({ success: false, message: '服务器内部错误，请稍后重试' });
  }
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

app.post('/api/checkin', async (req, res) => {
  const { checkin_code, reservation_id } = req.body;
  let targetReservation = null;
  const d0 = load();

  if (checkin_code) {
    targetReservation = d0.reservations.find(r => r.checkin_code === checkin_code);
  } else if (reservation_id) {
    targetReservation = d0.reservations.find(r => r.id === parseInt(reservation_id));
  }

  if (!targetReservation) {
    return res.status(404).json({ success: false, message: '预约信息不存在' });
  }

  const roomId = targetReservation.room_id;
  const reservationId = targetReservation.id;

  try {
    const result = await roomTransaction(roomId, async (d) => {
      const reservation = d.reservations.find(r => r.id === reservationId);
      if (!reservation) {
        return { httpStatus: 404, success: false, message: '预约信息不存在' };
      }

      if (reservation.status === 'checked_in') {
        return { httpStatus: 400, success: false, message: '已办理入住，请勿重复核销' };
      }
      if (reservation.status === 'completed' || reservation.status === 'cancelled') {
        return { httpStatus: 400, success: false, message: '预约已完成或已取消，无法核销' };
      }

      const now = new Date();
      const startTime = new Date(reservation.start_time);
      const endTime = new Date(reservation.end_time);

      if (now < new Date(startTime.getTime() - 30 * 60 * 1000)) {
        const allowTime = new Date(startTime.getTime() - 30 * 60 * 1000);
        return {
          httpStatus: 400,
          success: false,
          message: `尚未到提前30分钟的入场时间，最早可核销时间：${allowTime.toLocaleString()}`
        };
      }

      if (now > new Date(endTime.getTime() + 30 * 60 * 1000)) {
        return {
          httpStatus: 400,
          success: false,
          message: '预约已超时超过30分钟，无法核销，请取消后重新预约或联系管理员'
        };
      }

      const activeCheckedIn = countOverlappingCheckedIn(d, roomId, startTime, endTime, reservationId);
      if (activeCheckedIn > 0) {
        return {
          httpStatus: 400,
          success: false,
          message: `包间核销异常：该时间段内已有${activeCheckedIn}个场次正在使用，存在超核风险，请先确认包间实际使用情况后再操作`,
          data: { overcheck_count: activeCheckedIn }
        };
      }

      const totalActive = countRoomCheckedIn(d, roomId);
      if (totalActive > 0) {
        return {
          httpStatus: 400,
          success: false,
          message: `包间当前有${totalActive}个场次正在使用中，无法再次核销，请确认包间是否已结算退房`,
          data: { active_count: totalActive }
        };
      }

      const conflict = findTimeConflict(d, roomId, startTime, endTime, reservationId);
      if (conflict && conflict.status === 'checked_in') {
        return {
          httpStatus: 400,
          success: false,
          message: `该时间段包间已有核销记录（订单号：${conflict.id}，客户：${conflict.customer_name}），存在超核风险`,
          data: { conflict_id: conflict.id }
        };
      }

      reservation.status = 'checked_in';
      reservation.checkin_time = now.toISOString();

      const room = d.rooms.find(r => r.id === reservation.room_id);
      if (room) room.status = 'occupied';

      return {
        httpStatus: 200,
        success: true,
        message: '核验成功，欢迎光临',
        data: { id: reservation.id }
      };
    });

    res.status(result.httpStatus || 200).json({
      success: result.success,
      message: result.message,
      data: result.data
    });
  } catch (err) {
    console.error('核销异常:', err);
    res.status(500).json({ success: false, message: '服务器内部错误，请稍后重试' });
  }
});

// ==================== 消费结算 ====================

app.post('/api/checkout/:id', async (req, res) => {
  const { payment_method, extra_charge, remark } = req.body;
  const reservationId = parseInt(req.params.id);
  let targetRoomId = null;
  const d0 = load();
  const tmpResv = d0.reservations.find(r => r.id === reservationId);
  if (!tmpResv) {
    return res.status(404).json({ success: false, message: '预约不存在' });
  }
  targetRoomId = tmpResv.room_id;

  try {
    const result = await roomTransaction(targetRoomId, async (d) => {
      const reservation = d.reservations.find(r => r.id === reservationId);
      if (!reservation) {
        return { httpStatus: 404, success: false, message: '预约不存在' };
      }
      if (reservation.status === 'completed' || reservation.status === 'cancelled') {
        return { httpStatus: 400, success: false, message: '订单已结算或已取消' };
      }

      const room = d.rooms.find(r => r.id === reservation.room_id);
      if (!room) {
        return { httpStatus: 400, success: false, message: '包间数据异常' };
      }

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

      const remainingCheckedIn = d.reservations.filter(r =>
        r.room_id === reservation.room_id &&
        r.status === 'checked_in' &&
        r.id !== reservation.id
      ).length;

      if (remainingCheckedIn === 0) {
        room.status = 'idle';
      }

      return {
        httpStatus: 200,
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
      };
    });

    res.status(result.httpStatus || 200).json({
      success: result.success,
      message: result.message,
      data: result.data
    });
  } catch (err) {
    console.error('结算异常:', err);
    res.status(500).json({ success: false, message: '服务器内部错误，请稍后重试' });
  }
});

app.post('/api/reservations/:id/cancel', async (req, res) => {
  const reservationId = parseInt(req.params.id);
  let targetRoomId = null;
  const d0 = load();
  const tmpResv = d0.reservations.find(r => r.id === reservationId);
  if (!tmpResv) {
    return res.status(404).json({ success: false, message: '预约不存在' });
  }
  targetRoomId = tmpResv.room_id;

  try {
    const result = await roomTransaction(targetRoomId, async (d) => {
      const reservation = d.reservations.find(r => r.id === reservationId);
      if (!reservation) {
        return { httpStatus: 404, success: false, message: '预约不存在' };
      }
      if (reservation.status === 'checked_in') {
        return { httpStatus: 400, success: false, message: '已入住，不可取消，请办理结算' };
      }
      if (reservation.status !== 'booked') {
        return { httpStatus: 400, success: false, message: '当前状态不可取消' };
      }
      reservation.status = 'cancelled';
      return { httpStatus: 200, success: true, message: '预约已取消' };
    });

    res.status(result.httpStatus || 200).json({
      success: result.success,
      message: result.message
    });
  } catch (err) {
    console.error('取消预约异常:', err);
    res.status(500).json({ success: false, message: '服务器内部错误，请稍后重试' });
  }
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
  const autoRes = refreshRoomStatus(parseInt(room_id));
  res.json({
    success: true,
    data: {
      id,
      fault_ids: faultIds,
      room_locked: faultItems.length > 0,
      auto_cancelled_count: autoRes.cancelled,
      auto_cancelled: autoRes.cancelled_details
    }
  });
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
  const autoRes2 = refreshRoomStatus(rid);
  res.json({
    success: true,
    data: {
      ...fault,
      auto_cancelled_count: autoRes2.cancelled,
      auto_cancelled: autoRes2.cancelled_details
    }
  });
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
  const autoRes3 = refreshRoomStatus(d.faults[idx].room_id);
  res.json({
    success: true,
    message: '状态更新成功',
    auto_cancelled_count: autoRes3.cancelled,
    auto_cancelled: autoRes3.cancelled_details
  });
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
  const autoRes4 = refreshRoomStatus(d.faults[faultIdx].room_id);
  res.json({
    success: true,
    data: {
      ...repair,
      auto_cancelled_count: autoRes4.cancelled,
      auto_cancelled: autoRes4.cancelled_details
    }
  });
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

// ==================== 统计排行 ====================

app.get('/api/stats/rankings', (req, res) => {
  const { start_date, end_date } = req.query;
  const d = load();

  let startDate = null;
  let endDate = null;
  if (start_date) startDate = new Date(start_date);
  if (end_date) {
    endDate = new Date(end_date);
    endDate.setDate(endDate.getDate() + 1);
  }

  function inRange(dateStr) {
    const dt = new Date(dateStr);
    if (startDate && dt < startDate) return false;
    if (endDate && dt >= endDate) return false;
    return true;
  }

  const completedReservations = d.reservations.filter(r =>
    r.status === 'completed' && inRange(r.checkout_time || r.end_time)
  );

  const allCheckedInReservations = d.reservations.filter(r =>
    ['checked_in', 'completed'].includes(r.status) &&
    inRange(r.checkin_time || r.start_time)
  );

  const roomUsageMap = {};
  d.rooms.forEach(room => {
    roomUsageMap[room.id] = {
      room_id: room.id,
      room_name: room.name,
      room_type: room.type,
      total_hours: 0,
      reservation_count: 0,
      total_revenue: 0,
      capacity: room.capacity,
      price_per_hour: room.price_per_hour
    };
  });

  allCheckedInReservations.forEach(r => {
    const usage = roomUsageMap[r.room_id];
    if (usage) {
      const start = new Date(r.checkin_time || r.start_time);
      const end = new Date(r.checkout_time || r.end_time);
      const hours = Math.max(1, Math.ceil((end - start) / (1000 * 60 * 60)));
      usage.total_hours += hours;
      usage.reservation_count += 1;
      usage.total_revenue += r.total_amount || 0;
    }
  });

  let totalPeriodHours = 24 * 30;
  if (startDate && endDate) {
    totalPeriodHours = Math.max(24, Math.ceil((endDate - startDate) / (1000 * 60 * 60)));
  }

  const roomRankings = Object.values(roomUsageMap).map(u => ({
    ...u,
    usage_rate: totalPeriodHours > 0 ? Math.min(100, (u.total_hours / totalPeriodHours) * 100) : 0
  })).sort((a, b) => b.total_hours - a.total_hours);

  roomRankings.forEach((r, idx) => { r.rank = idx + 1; });

  const movieWatchMap = {};
  d.movies.forEach(movie => {
    movieWatchMap[movie.id] = {
      movie_id: movie.id,
      movie_title: movie.title,
      category_id: movie.category_id,
      category_name: null,
      duration: movie.duration,
      rating: movie.rating,
      watch_count: 0,
      total_hours: 0,
      total_revenue: 0
    };
  });

  allCheckedInReservations.forEach(r => {
    if (r.movie_id && movieWatchMap[r.movie_id]) {
      const mw = movieWatchMap[r.movie_id];
      mw.watch_count += 1;
      const movie = d.movies.find(m => m.id === r.movie_id);
      if (movie) {
        mw.total_hours += movie.duration / 60;
        mw.category_name = (d.movie_categories.find(c => c.id === movie.category_id))?.name || null;
      }
      mw.total_revenue += r.total_amount || 0;
    }
  });

  const movieRankings = Object.values(movieWatchMap).filter(m => m.watch_count > 0)
    .sort((a, b) => b.watch_count - a.watch_count || b.total_hours - a.total_hours);
  movieRankings.forEach((m, idx) => { m.rank = idx + 1; });

  const deviceFaultMap = {};
  d.devices.forEach(dev => {
    deviceFaultMap[dev.id] = {
      device_id: dev.id,
      device_name: dev.name,
      device_type: dev.type_name,
      device_icon: dev.icon,
      room_id: dev.room_id,
      room_name: null,
      brand: dev.brand,
      model: dev.model,
      status: dev.status,
      purchase_date: dev.purchase_date,
      fault_count: 0,
      pending_count: 0,
      high_fault_count: 0,
      repair_count: 0,
      total_repair_cost: 0
    };
  });

  const filteredFaults = d.faults.filter(f => inRange(f.created_at));
  filteredFaults.forEach(f => {
    if (deviceFaultMap[f.device_id]) {
      const df = deviceFaultMap[f.device_id];
      df.fault_count += 1;
      if (!['resolved', 'closed'].includes(f.status)) df.pending_count += 1;
      if (f.level === 'high') df.high_fault_count += 1;
      const room = d.rooms.find(r => r.id === f.room_id);
      if (room) df.room_name = room.name;
    }
  });

  const filteredRepairs = d.repairs.filter(r => inRange(r.created_at));
  filteredRepairs.forEach(r => {
    const fault = d.faults.find(f => f.id === r.fault_id);
    if (fault && deviceFaultMap[fault.device_id]) {
      const df = deviceFaultMap[fault.device_id];
      df.repair_count += 1;
      df.total_repair_cost += r.cost || 0;
    }
  });

  Object.values(deviceFaultMap).forEach(df => {
    if (!df.room_name) {
      const room = d.rooms.find(r => r.id === df.room_id);
      if (room) df.room_name = room.name;
    }
  });

  const deviceRankings = Object.values(deviceFaultMap)
    .map(df => ({
      ...df,
      fault_rate: df.fault_count > 0 ? (df.fault_count / Math.max(1, d.faults.length)) * 100 : 0
    }))
    .sort((a, b) => b.fault_count - a.fault_count || b.high_fault_count - a.high_fault_count);
  deviceRankings.forEach((d, idx) => { d.rank = idx + 1; });

  const totalReservations = allCheckedInReservations.length;
  const totalRevenue = completedReservations.reduce((s, r) => s + (r.total_amount || 0), 0);
  const totalFaults = filteredFaults.length;
  const highFaults = filteredFaults.filter(f => f.level === 'high').length;
  const pendingFaults = filteredFaults.filter(f => !['resolved', 'closed'].includes(f.status)).length;
  const totalRepairCost = filteredRepairs.reduce((s, r) => s + (r.cost || 0), 0);

  res.json({
    success: true,
    data: {
      summary: {
        total_reservations: totalReservations,
        total_revenue: totalRevenue,
        total_faults: totalFaults,
        high_faults: highFaults,
        pending_faults: pendingFaults,
        total_repair_cost: totalRepairCost,
        period_start: startDate ? startDate.toISOString() : null,
        period_end: endDate ? endDate.toISOString() : null
      },
      room_rankings: roomRankings,
      movie_rankings: movieRankings,
      device_rankings: deviceRankings
    }
  });
});

app.get('/api/stats/rankings/rooms', (req, res) => {
  const { start_date, end_date } = req.query;
  const d = load();

  let startDate = null;
  let endDate = null;
  if (start_date) startDate = new Date(start_date);
  if (end_date) {
    endDate = new Date(end_date);
    endDate.setDate(endDate.getDate() + 1);
  }

  function inRange(dateStr) {
    const dt = new Date(dateStr);
    if (startDate && dt < startDate) return false;
    if (endDate && dt >= endDate) return false;
    return true;
  }

  const allCheckedInReservations = d.reservations.filter(r =>
    ['checked_in', 'completed'].includes(r.status) &&
    inRange(r.checkin_time || r.start_time)
  );

  const roomUsageMap = {};
  d.rooms.forEach(room => {
    roomUsageMap[room.id] = {
      room_id: room.id,
      room_name: room.name,
      room_type: room.type,
      total_hours: 0,
      reservation_count: 0,
      total_revenue: 0,
      capacity: room.capacity,
      price_per_hour: room.price_per_hour
    };
  });

  allCheckedInReservations.forEach(r => {
    const usage = roomUsageMap[r.room_id];
    if (usage) {
      const start = new Date(r.checkin_time || r.start_time);
      const end = new Date(r.checkout_time || r.end_time);
      const hours = Math.max(1, Math.ceil((end - start) / (1000 * 60 * 60)));
      usage.total_hours += hours;
      usage.reservation_count += 1;
      usage.total_revenue += r.total_amount || 0;
    }
  });

  let totalPeriodHours = 24 * 30;
  if (startDate && endDate) {
    totalPeriodHours = Math.max(24, Math.ceil((endDate - startDate) / (1000 * 60 * 60)));
  }

  const rankings = Object.values(roomUsageMap).map(u => ({
    ...u,
    usage_rate: totalPeriodHours > 0 ? Math.min(100, (u.total_hours / totalPeriodHours) * 100) : 0
  })).sort((a, b) => b.total_hours - a.total_hours);

  rankings.forEach((r, idx) => { r.rank = idx + 1; });

  res.json({ success: true, data: rankings });
});

app.get('/api/stats/rankings/movies', (req, res) => {
  const { start_date, end_date, category_id } = req.query;
  const d = load();

  let startDate = null;
  let endDate = null;
  if (start_date) startDate = new Date(start_date);
  if (end_date) {
    endDate = new Date(end_date);
    endDate.setDate(endDate.getDate() + 1);
  }

  function inRange(dateStr) {
    const dt = new Date(dateStr);
    if (startDate && dt < startDate) return false;
    if (endDate && dt >= endDate) return false;
    return true;
  }

  const allCheckedInReservations = d.reservations.filter(r =>
    ['checked_in', 'completed'].includes(r.status) &&
    inRange(r.checkin_time || r.start_time)
  );

  const movieWatchMap = {};
  d.movies.forEach(movie => {
    if (category_id && movie.category_id !== parseInt(category_id)) return;
    movieWatchMap[movie.id] = {
      movie_id: movie.id,
      movie_title: movie.title,
      category_id: movie.category_id,
      category_name: null,
      duration: movie.duration,
      rating: movie.rating,
      watch_count: 0,
      total_hours: 0,
      total_revenue: 0
    };
  });

  allCheckedInReservations.forEach(r => {
    if (r.movie_id && movieWatchMap[r.movie_id]) {
      const mw = movieWatchMap[r.movie_id];
      mw.watch_count += 1;
      const movie = d.movies.find(m => m.id === r.movie_id);
      if (movie) {
        mw.total_hours += movie.duration / 60;
        mw.category_name = (d.movie_categories.find(c => c.id === movie.category_id))?.name || null;
      }
      mw.total_revenue += r.total_amount || 0;
    }
  });

  const rankings = Object.values(movieWatchMap)
    .sort((a, b) => b.watch_count - a.watch_count || b.total_hours - a.total_hours);
  rankings.forEach((m, idx) => { m.rank = idx + 1; });

  res.json({ success: true, data: rankings });
});

app.get('/api/stats/rankings/devices', (req, res) => {
  const { start_date, end_date, room_id, status } = req.query;
  const d = load();

  let startDate = null;
  let endDate = null;
  if (start_date) startDate = new Date(start_date);
  if (end_date) {
    endDate = new Date(end_date);
    endDate.setDate(endDate.getDate() + 1);
  }

  function inRange(dateStr) {
    const dt = new Date(dateStr);
    if (startDate && dt < startDate) return false;
    if (endDate && dt >= endDate) return false;
    return true;
  }

  const deviceFaultMap = {};
  d.devices.forEach(dev => {
    if (room_id && dev.room_id !== parseInt(room_id)) return;
    if (status && dev.status !== status) return;
    deviceFaultMap[dev.id] = {
      device_id: dev.id,
      device_name: dev.name,
      device_type: dev.type_name,
      device_icon: dev.icon,
      room_id: dev.room_id,
      room_name: null,
      brand: dev.brand,
      model: dev.model,
      status: dev.status,
      purchase_date: dev.purchase_date,
      fault_count: 0,
      pending_count: 0,
      high_fault_count: 0,
      repair_count: 0,
      total_repair_cost: 0
    };
  });

  const filteredFaults = d.faults.filter(f => inRange(f.created_at));
  filteredFaults.forEach(f => {
    if (deviceFaultMap[f.device_id]) {
      const df = deviceFaultMap[f.device_id];
      df.fault_count += 1;
      if (!['resolved', 'closed'].includes(f.status)) df.pending_count += 1;
      if (f.level === 'high') df.high_fault_count += 1;
      const room = d.rooms.find(r => r.id === f.room_id);
      if (room) df.room_name = room.name;
    }
  });

  const filteredRepairs = d.repairs.filter(r => inRange(r.created_at));
  filteredRepairs.forEach(r => {
    const fault = d.faults.find(f => f.id === r.fault_id);
    if (fault && deviceFaultMap[fault.device_id]) {
      const df = deviceFaultMap[fault.device_id];
      df.repair_count += 1;
      df.total_repair_cost += r.cost || 0;
    }
  });

  Object.values(deviceFaultMap).forEach(df => {
    if (!df.room_name) {
      const room = d.rooms.find(r => r.id === df.room_id);
      if (room) df.room_name = room.name;
    }
  });

  const totalFaultsInPeriod = filteredFaults.length || 1;
  const rankings = Object.values(deviceFaultMap)
    .map(df => ({
      ...df,
      fault_rate: (df.fault_count / totalFaultsInPeriod) * 100
    }))
    .sort((a, b) => b.fault_count - a.fault_count || b.high_fault_count - a.high_fault_count);
  rankings.forEach((d, idx) => { d.rank = idx + 1; });

  res.json({ success: true, data: rankings });
});

// ==================== 辅助函数：包间状态自动联动 ====================

function fmtDTLocal(dateIso) {
  const d = new Date(dateIso);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function faultLevelText(level) {
  const map = { low: '低', medium: '中', high: '高' };
  return map[level] || level;
}

function refreshRoomStatus(roomId) {
  const d = load();
  const idx = d.rooms.findIndex(r => r.id === roomId);
  if (idx === -1) return { cancelled: 0, cancelled_details: [] };
  const room = d.rooms[idx];

  const pendingFaults = d.faults.filter(f =>
    f.room_id === roomId && !['resolved', 'closed'].includes(f.status)
  );

  const isOccupied = d.reservations.some(r =>
    r.room_id === roomId && r.status === 'checked_in' && new Date(r.end_time) > new Date()
  );

  let autoCancelled = [];
  const now = new Date();

  if (pendingFaults.length > 0) {
    if (room.status === 'idle') {
      d.rooms[idx].status = 'maintenance';
    }
    if (!isOccupied) {
      const futureBooked = d.reservations.filter(r =>
        r.room_id === roomId && r.status === 'booked' && new Date(r.start_time) > now
      );
      const faultSummary = pendingFaults.map(f => `[${faultLevelText(f.level)}级]${f.title}`).join('; ');
      futureBooked.forEach(r => {
        r.status = 'cancelled';
        r.cancel_reason = `【系统自动取消】包间${room.name}存在${pendingFaults.length}项未解决设备故障：${faultSummary}。为保障观影体验，系统已自动取消本次预约，请及时联系客户改期或退款。`;
        r.cancelled_at = now.toISOString();
        r.cancelled_by = 'system';
        autoCancelled.push({
          id: r.id,
          customer: r.customer_name,
          phone: r.customer_phone,
          time: fmtDTLocal(r.start_time),
          amount: r.total_amount
        });
      });
    }
    save();
    return { cancelled: autoCancelled.length, cancelled_details: autoCancelled };
  }

  if (pendingFaults.length === 0 && room.status === 'maintenance') {
    d.rooms[idx].status = 'idle';
    save();
    return { cancelled: 0, cancelled_details: [] };
  }
  return { cancelled: 0, cancelled_details: [] };
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
