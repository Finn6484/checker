const assert = require('assert');
const app = require('../server');

async function testServer() {
  console.log('====================================================');
  console.log('🌐 開始執行 Express 伺服器 API 端點測試');
  console.log('====================================================\n');

  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  try {
    // 0. 重設測試群組資料以確保冪等性
    await fetch(`${baseUrl}/api/mock/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId: 'mock-group' })
    });

    // 1. Health check
    const healthRes = await fetch(`${baseUrl}/api/health`);
    const health = await healthRes.json();
    assert.strictEqual(health.status, 'ok');
    console.log('  ✔ [GET /api/health] 健康檢查通過');

    // 2. Status query
    const statusRes = await fetch(`${baseUrl}/api/status?groupId=mock-group&userId=mock-user-me`);
    const status = await statusRes.json();
    assert.strictEqual(status.success, true);
    assert.ok(status.data.target != null);
    console.log('  ✔ [GET /api/status] 群組狀態查詢通過 (地點:', status.data.target.name, ')');

    // 3. Out of range checkin test (> 100m)
    const outCheckRes = await fetch(`${baseUrl}/api/checkin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        groupId: 'mock-group',
        userId: 'mock-user-me',
        displayName: '測試者',
        lat: 25.040000, // 遠離台北 101 (> 500m)
        lng: 121.570000
      })
    });
    assert.strictEqual(outCheckRes.status, 400, '超過 100 公尺應回傳 400');
    const outCheckJson = await outCheckRes.json();
    assert.strictEqual(outCheckJson.inRange, false);
    console.log('  ✔ [POST /api/checkin - 範圍外攔截] 成功攔截超出 100m 打卡 (距離:', outCheckJson.distance, 'm)');

    // 4. In range checkin test (<= 100m)
    const inCheckRes = await fetch(`${baseUrl}/api/checkin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        groupId: 'mock-group',
        userId: 'mock-user-me',
        displayName: '測試者',
        lat: 25.033964 + 0.0001, // ~15m
        lng: 121.564468
      })
    });
    assert.strictEqual(inCheckRes.status, 200, '範圍內打卡應回傳 200');
    const inCheckJson = await inCheckRes.json();
    assert.strictEqual(inCheckJson.success, true);
    assert.strictEqual(inCheckJson.inRange, true);
    console.log('  ✔ [POST /api/checkin - 範圍內打卡] 打卡成功 (距離:', inCheckJson.distance, 'm)');

    // 5. Mock teammate check-in
    const mockRes = await fetch(`${baseUrl}/api/mock/checkin-other`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupId: 'mock-group' })
    });
    const mockJson = await mockRes.json();
    assert.strictEqual(mockJson.success, true);
    console.log('  ✔ [POST /api/mock/checkin-other] 模擬隊友打卡成功:', mockJson.message);

    console.log('\n====================================================');
    console.log('🎉 所有伺服器 API 端點測試皆順利通過！');
    console.log('====================================================');
  } finally {
    server.close();
  }
}

testServer().catch((err) => {
  console.error('❌ 伺服器端點測試失敗:', err);
  process.exit(1);
});
