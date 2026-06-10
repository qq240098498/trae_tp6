const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'cinema_data.json');

const DEFAULT_DATA = {
  rooms: [],
  movie_categories: [],
  movies: [],
  reservations: [],
  transactions: [],
  devices: [],
  inspections: [],
  faults: [],
  repairs: [],
  _ids: {
    rooms: 0,
    movie_categories: 0,
    movies: 0,
    reservations: 0,
    transactions: 0,
    devices: 0,
    inspections: 0,
    faults: 0,
    repairs: 0
  }
};

let data = null;
let writeQueue = Promise.resolve();
const roomLocks = new Map();

function load() {
  if (data) return data;
  if (fs.existsSync(DB_PATH)) {
    try {
      data = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
    } catch (e) {
      console.error('数据库文件损坏，重新初始化', e);
      data = JSON.parse(JSON.stringify(DEFAULT_DATA));
      saveSync();
    }
  } else {
    console.log('数据库不存在，正在初始化...');
    data = JSON.parse(JSON.stringify(DEFAULT_DATA));
    initDefaultData();
    saveSync();
  }
  return data;
}

function saveSync() {
  if (!data) return;
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

function save() {
  writeQueue = writeQueue.then(() => {
    return new Promise((resolve) => {
      setImmediate(() => {
        try {
          saveSync();
        } catch (e) {
          console.error('保存数据库失败:', e);
        }
        resolve();
      });
    });
  });
  return writeQueue;
}

function acquireRoomLock(roomId) {
  const key = `room_${roomId}`;
  let resolveNext;
  const previousLock = roomLocks.get(key) || Promise.resolve();
  const nextLock = new Promise((resolve) => {
    resolveNext = resolve;
  });
  roomLocks.set(key, nextLock);
  return previousLock.then(() => ({
    release: () => {
      resolveNext();
      if (roomLocks.get(key) === nextLock) {
        roomLocks.delete(key);
      }
    }
  }));
}

function transaction(fn) {
  writeQueue = writeQueue.then(async () => {
    load();
    try {
      const result = await fn(data);
      saveSync();
      return result;
    } catch (e) {
      console.error('事务执行异常:', e);
      throw e;
    }
  });
  return writeQueue;
}

function roomTransaction(roomId, fn) {
  return acquireRoomLock(roomId).then(async (lock) => {
    try {
      load();
      const result = await fn(data);
      saveSync();
      return result;
    } finally {
      lock.release();
    }
  });
}

function nextId(table) {
  load();
  data._ids[table] = (data._ids[table] || 0) + 1;
  saveSync();
  return data._ids[table];
}

function initDefaultData() {
  const rooms = [
    { name: 'A101', type: '情侣小包', capacity: 2, price_per_hour: 68, status: 'idle' },
    { name: 'A102', type: '情侣小包', capacity: 2, price_per_hour: 68, status: 'idle' },
    { name: 'A103', type: '情侣小包', capacity: 2, price_per_hour: 68, status: 'idle' },
    { name: 'B201', type: '商务中包', capacity: 4, price_per_hour: 128, status: 'idle' },
    { name: 'B202', type: '商务中包', capacity: 4, price_per_hour: 128, status: 'idle' },
    { name: 'B203', type: '商务中包', capacity: 6, price_per_hour: 158, status: 'idle' },
    { name: 'C301', type: '豪华大包', capacity: 10, price_per_hour: 298, status: 'idle' },
    { name: 'C302', type: '豪华大包', capacity: 10, price_per_hour: 298, status: 'idle' },
    { name: 'D401', type: 'VIP派对包', capacity: 20, price_per_hour: 588, status: 'idle' },
  ];
  rooms.forEach(r => {
    const id = nextId('rooms');
    data.rooms.push({ ...r, id, created_at: new Date().toISOString() });
  });

  const deviceTypes = [
    { type: 'projector', name: '投影机', icon: '📽️' },
    { type: 'speaker', name: '音响系统', icon: '🔊' },
    { type: 'ac', name: '空调', icon: '❄️' },
    { type: 'light', name: '灯光系统', icon: '💡' },
    { type: 'screen', name: '幕布', icon: '🎞️' },
    { type: 'sofa', name: '沙发座椅', icon: '🛋️' }
  ];
  data.rooms.forEach(room => {
    deviceTypes.forEach(dt => {
      const devId = nextId('devices');
      data.devices.push({
        id: devId,
        room_id: room.id,
        name: `${room.name}-${dt.name}`,
        type: dt.type,
        type_name: dt.name,
        icon: dt.icon,
        brand: dt.type === 'projector' ? '爱普生' : dt.type === 'speaker' ? 'BOSE' : dt.type === 'ac' ? '格力' : dt.type === 'light' ? '飞利浦' : '-',
        model: dt.type === 'projector' ? 'CB-X41' : dt.type === 'speaker' ? 'Acoustimass 6' : dt.type === 'ac' ? 'KFR-72LW' : dt.type === 'light' ? 'BR126' : '-',
        purchase_date: new Date(Date.now() - Math.random() * 365 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        status: 'normal',
        last_inspection: null,
        remark: '',
        created_at: new Date().toISOString()
      });
    });
  });

  console.log('初始化完成:');
  console.log('  - 包间:', data.rooms.length);
  console.log('  - 设备:', data.devices.length);
  console.log('  - 分类:', data.movie_categories.length);
  console.log('  - 影片:', data.movies.length);
  const categoryMap = {};
  const categories = [
    { name: '动作片', description: '刺激精彩的动作电影' },
    { name: '爱情片', description: '浪漫温馨的爱情故事' },
    { name: '科幻片', description: '想象力丰富的科幻大作' },
    { name: '喜剧片', description: '轻松搞笑的喜剧电影' },
    { name: '恐怖片', description: '惊悚刺激的恐怖电影' },
    { name: '动画片', description: '老少皆宜的动画佳作' },
    { name: '纪录片', description: '真实记录的纪录片' },
    { name: '经典老片', description: '永不过时的经典作品' },
  ];
  categories.forEach(c => {
    const id = nextId('movie_categories');
    categoryMap[c.name] = id;
    data.movie_categories.push({ ...c, id, created_at: new Date().toISOString() });
  });

  const movies = [
    { title: '速度与激情10', category: '动作片', duration: 141, rating: 8.5, description: '多米尼克·托莱多带领他的家人面对迄今为止最致命的对手。', release_year: 2023 },
    { title: '碟中谍7', category: '动作片', duration: 163, rating: 8.8, description: '伊森·亨特和他的IMF团队开始寻找一种会威胁全人类生存的可怕武器。', release_year: 2023 },
    { title: '长津湖', category: '动作片', duration: 176, rating: 9.5, description: '抗美援朝战争中长津湖战役的壮烈故事。', release_year: 2021 },
    { title: '泰坦尼克号', category: '爱情片', duration: 195, rating: 9.4, description: '一段发生在泰坦尼克号上的跨阶级爱情故事。', release_year: 1997 },
    { title: '爱在黎明破晓前', category: '爱情片', duration: 101, rating: 8.8, description: '一对陌生男女在维也纳度过浪漫的一天。', release_year: 1995 },
    { title: '你的婚礼', category: '爱情片', duration: 115, rating: 7.8, description: '一段跨越青春的校园爱情故事。', release_year: 2021 },
    { title: '星际穿越', category: '科幻片', duration: 169, rating: 9.4, description: '一组探险家穿越虫洞寻找人类新家园的史诗冒险。', release_year: 2014 },
    { title: '流浪地球2', category: '科幻片', duration: 173, rating: 9.0, description: '太阳即将毁灭，人类开启移山计划拯救地球。', release_year: 2023 },
    { title: '盗梦空间', category: '科幻片', duration: 148, rating: 9.3, description: '进入他人梦境窃取机密的科幻冒险。', release_year: 2010 },
    { title: '夏洛特烦恼', category: '喜剧片', duration: 104, rating: 8.9, description: '穿越回学生时代的爆笑喜剧。', release_year: 2015 },
    { title: '西虹市首富', category: '喜剧片', duration: 118, rating: 8.5, description: '一个月花光十亿的爆笑挑战。', release_year: 2018 },
    { title: '你好，李焕英', category: '喜剧片', duration: 128, rating: 8.8, description: '穿越回妈妈年轻时代的温喜剧。', release_year: 2021 },
    { title: '午夜凶铃', category: '恐怖片', duration: 116, rating: 8.2, description: '看过神秘录像带的人七天后死亡的恐怖传说。', release_year: 1998 },
    { title: '招魂', category: '恐怖片', duration: 112, rating: 8.0, description: '真实事件改编的超自然恐怖故事。', release_year: 2013 },
    { title: '釜山行', category: '恐怖片', duration: 118, rating: 8.6, description: '丧尸病毒爆发下列车上的生死逃亡。', release_year: 2016 },
    { title: '千与千寻', category: '动画片', duration: 125, rating: 9.4, description: '少女千寻在神秘神灵世界的冒险。', release_year: 2001 },
    { title: '疯狂动物城', category: '动画片', duration: 109, rating: 9.2, description: '兔子警官与狐狸搭档破案的故事。', release_year: 2016 },
    { title: '哪吒之魔童降世', category: '动画片', duration: 110, rating: 8.9, description: '我命由我不由天的哪吒传奇。', release_year: 2019 },
    { title: '地球脉动', category: '纪录片', duration: 480, rating: 9.9, description: 'BBC经典自然纪录片系列。', release_year: 2006 },
    { title: '人间世', category: '纪录片', duration: 600, rating: 9.6, description: '记录医院里的人生百态。', release_year: 2016 },
    { title: '霸王别姬', category: '经典老片', duration: 171, rating: 9.6, description: '两个京剧伶人半个世纪的悲欢离合。', release_year: 1993 },
    { title: '肖申克的救赎', category: '经典老片', duration: 142, rating: 9.7, description: '银行家在肖申克监狱的希望与自由。', release_year: 1994 },
    { title: '阿甘正传', category: '经典老片', duration: 142, rating: 9.5, description: '一个智商不高的男人的传奇人生。', release_year: 1994 },
  ];
  movies.forEach(m => {
    const id = nextId('movies');
    data.movies.push({
      id,
      title: m.title,
      category_id: categoryMap[m.category] || null,
      duration: m.duration,
      rating: m.rating,
      description: m.description,
      release_year: m.release_year,
      poster_url: null,
      created_at: new Date().toISOString()
    });
  });

  console.log('初始化完成:');
  console.log('  - 包间:', data.rooms.length);
  console.log('  - 分类:', data.movie_categories.length);
  console.log('  - 影片:', data.movies.length);
}

function reset() {
  if (fs.existsSync(DB_PATH)) {
    fs.unlinkSync(DB_PATH);
  }
  data = null;
  load();
}

function findTimeConflict(d, roomId, start, end, excludeReservationId = null) {
  return d.reservations.find(r => {
    if (r.room_id !== roomId) return false;
    if (excludeReservationId && r.id === excludeReservationId) return false;
    if (!['booked', 'checked_in'].includes(r.status)) return false;
    const rs = new Date(r.start_time);
    const re = new Date(r.end_time);
    return (start < re && end > rs);
  });
}

function countRoomCheckedIn(d, roomId) {
  const now = new Date();
  return d.reservations.filter(r =>
    r.room_id === roomId &&
    r.status === 'checked_in' &&
    new Date(r.end_time) > now
  ).length;
}

function countOverlappingCheckedIn(d, roomId, start, end, excludeReservationId = null) {
  return d.reservations.filter(r => {
    if (r.room_id !== roomId) return false;
    if (r.status !== 'checked_in') return false;
    if (excludeReservationId && r.id === excludeReservationId) return false;
    const rs = new Date(r.start_time);
    const re = new Date(r.end_time);
    return (start < re && end > rs);
  }).length;
}

module.exports = {
  load,
  save,
  saveSync,
  nextId,
  reset,
  DB_PATH,
  transaction,
  roomTransaction,
  findTimeConflict,
  countRoomCheckedIn,
  countOverlappingCheckedIn
};
