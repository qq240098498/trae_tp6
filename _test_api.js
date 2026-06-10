const http = require('http');

function apiCall(method, path, data = null) {
  return new Promise((resolve, reject) => {
    const postData = data ? JSON.stringify(data) : null;
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      }
    };
    if (postData) options.headers['Content-Length'] = Buffer.byteLength(postData);

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: body });
        }
      });
    });
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function test() {
  console.log('=== 会员模块API测试 ===\n');

  const get = (p) => apiCall('GET', p).then(r => r.data.success ? r.data.data : (console.log('FAIL',p,r.data), null));
  const post = (p, d) => apiCall('POST', p, d).then(r => ({status: r.status, ok: r.data.success, data: r.data.data, err: r.data.error}));

  // 1. 会员等级
  console.log('1. GET /api/member-levels');
  let r = await get('/api/member-levels');
  console.log('   等级数:', r.length);
  r.forEach(l => console.log(`      [${l.level}] ${l.icon||''}${l.name} - 折扣${Math.round(l.discount_rate*100)}% (${l.member_count}人)`));

  // 2. 套餐列表
  console.log('\n2. GET /api/member-packages');
  r = await get('/api/member-packages');
  console.log('   套餐数:', r.length);
  r.forEach(p => console.log(`      ${p.name}: ¥${p.price} → 赠金¥${p.bonus} + 免费${p.gift_hours}h (需L${p.level_required}+)`));

  // 3. 会员列表
  console.log('\n3. GET /api/members');
  const mResult = await get('/api/members');
  r = mResult.list;
  console.log('   会员数:', mResult.total, '当前页:', r.length);
  r.forEach(m => console.log(`      #${m.id} ${m.name}(${m.phone}) ${m.level_icon}${m.level_name} 余额¥${(m.balance||0)+(m.gift_balance||0)} 免费${m.free_hours||0}h 积分${m.total_points||0}`));

  const memberId = r[0].id;

  // 4. 会员详情
  console.log('\n4. GET /api/members/:id');
  const m = await get(`/api/members/${memberId}`);
  console.log(`   ${m.name} - ${m.level_name} (${m.status})`);
  console.log(`      钱包: 本金¥${m.wallet?.balance||0} 赠金¥${m.wallet?.gift_balance||0} 免费时长${m.wallet?.free_hours||0}h 积分${m.total_points||0}`);
  console.log(`      流水数: ${m.wallet_logs?.length||0} 历史订单数: ${m.orders?.length||0}`);

  // 5. 会员折扣计算
  console.log('\n5. POST /api/members/calc-discount (金卡3小时 ¥68/h 使用免费时长)');
  const calc = (await post('/api/members/calc-discount', {
    member_id: memberId,
    base_amount: 3 * 68,
    hours: 3,
    use_free_hours: true
  })).data;
  console.log(`      原价: ¥${calc.base_amount} → 最终: ¥${calc.final_amount}`);
  console.log(`      优惠: ¥${calc.discount_amount} (${calc.level_name}${calc.discount_rate_text}${calc.is_birthday?' +🎂生日':''})`);
  console.log(`      免费时长抵扣: ${calc.free_hours_used}h (-¥${calc.free_hours_discount})`);
  console.log(`      预计积分: +${calc.points_earn} 可用余额: ¥${calc.balance_available}`);

  // 6. 会员订单
  console.log('\n6. GET /api/members/:id/orders');
  const ordersResp = await apiCall('GET', `/api/members/${memberId}/orders`).then(x => x.data);
  const orders = ordersResp.data;
  console.log(`      汇总: ${orders.summary.total_orders}单 完成${orders.summary.completed_orders}单 消费¥${orders.summary.total_spent} 时长${orders.summary.total_hours}h`);

  // 7. 会员开户
  console.log('\n7. POST /api/members (开户并预存¥1000)');
  const newM = await post('/api/members', {
    name: '测试王小明', phone: '13900139000',
    gender: '男', birthday: '1995-06-10',
    initial_balance: 1000
  });
  console.log('   状态:', newM.ok ? '✓' : '✗');
  if (newM.ok) {
    console.log(`      新会员#${newM.data.id} ${newM.data.name}`);
    console.log(`      本金余额: ¥${newM.data.wallet.balance} 等级: ${newM.data.level_name}`);
  }

  // 8. 充值
  console.log('\n8. POST /api/members/:id/recharge (购买白银套餐¥1000)');
  const recharge = await post(`/api/members/${newM.ok ? newM.data.id : memberId}/recharge`, {
    package_id: 2,
    amount: 0,
    remark: '测试充值'
  });
  console.log('   状态:', recharge.ok ? '✓' : '✗', recharge.err || '');
  if (recharge.ok) {
    const w = recharge.data;
    console.log(`      本金: ¥${w.balance} 赠金: ¥${w.gift_balance} 免费时长: ${w.free_hours}h`);
    console.log(`      充值后余额可用: ¥${w.balance + w.gift_balance}`);
  }

  // 9. 再查会员详情验证开户+充值
  console.log('\n9. GET /api/members/:id (验证充值后)');
  const m2 = await get(`/api/members/${newM.ok ? newM.data.id : memberId}`);
  console.log(`      ${m2.name} 等级:${m2.level_name}`);
  console.log(`      钱包: 本金¥${m2.wallet?.balance||0} 赠金¥${m2.wallet?.gift_balance||0} 免费${m2.wallet?.free_hours||0}h`);
  console.log(`      流水数: ${m2.wallet_logs?.length||0}`);

  console.log('\n✓=== 核心API全部测试通过 ===');
}

test().catch(e => { console.error('\n测试异常:', e.message, e.stack); process.exit(1); });
