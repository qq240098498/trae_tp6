const db = require('./db');
const fs = require('fs');

if (fs.existsSync(db.DB_PATH)) {
  fs.unlinkSync(db.DB_PATH);
  console.log('旧数据库已删除');
}

console.log('开始初始化数据库...\n');
db.reset();

console.log('\n✅ 数据库初始化完成!');
console.log('数据文件路径:', db.DB_PATH);
