const http = require('http');
const https = require('https');
const fs = require('fs');
const url = require('url');
const querystring = require('querystring');

// 存储所有请求数据
let requests = [];

// ============ 海康事件数据解析函数 ============
/**
 * 解析海康事件推送数据
 * @param {Object} data - 原始数据对象
 * @returns {Object} 解析后的事件数据
 */
function parseHikvisionEvent(data) {
  const result = {
    method: data.method || 'unknown',
    ability: data.ability || '',
    sendTime: '',
    events: [],
    raw: data
  };

  // 解析params部分
  if (data.params) {
    result.sendTime = data.params.sendTime || '';
    
    // 解析events数组
    if (data.params.events && Array.isArray(data.params.events)) {
      result.events = data.params.events.map((event, index) => {
        return {
          index: index + 1,
          eventId: event.eventId || '',
          eventType: event.eventType || event.eventiype || 0, // 兼容拼写错误
          eventTypeName: getEventTypeName(event.eventType || event.eventiype || 0),
          happenTime: event.happenTime || event.hapenTime || '', // 兼容拼写错误
          srcIndex: event.srcIndex || '',
          srcName: event.srcName || '',
          srcParentIndex: event.srcParentIndex || '',
          srcType: event.srcType || event.srciype || '', // 兼容拼写错误
          status: event.status || 0,
          timeout: event.timeout || 0,
          raw: event
        };
      });
    } else if (data.params.events && typeof data.params.events === 'object') {
      // 如果events不是数组而是单个对象
      const event = data.params.events;
      result.events = [{
        index: 1,
        eventId: event.eventId || '',
        eventType: event.eventType || event.eventiype || 0,
        eventTypeName: getEventTypeName(event.eventType || event.eventiype || 0),
        happenTime: event.happenTime || event.hapenTime || '',
        srcIndex: event.srcIndex || '',
        srcName: event.srcName || '',
        srcParentIndex: event.srcParentIndex || '',
        srcType: event.srcType || event.srciype || '',
        status: event.status || 0,
        timeout: event.timeout || 0,
        raw: event
      }];
    }
  }

  return result;
}

/**
 * 获取事件类型名称（根据事件类型代码）
 * @param {Number} eventType - 事件类型代码
 * @returns {String} 事件类型名称
 */
function getEventTypeName(eventType) {
  const eventTypeMap = {
    131331: '智能分析事件',
    131329: '智能分析事件',
    196893: '智能分析事件',
    // 可以根据需要添加更多事件类型映射
  };
  return eventTypeMap[eventType] || `未知事件类型(${eventType})`;
}

/**
 * 格式化显示解析后的事件数据
 * @param {Object} parsedData - 解析后的事件数据
 */
function formatEventDisplay(parsedData) {
  console.log('\n============ 海康事件解析结果 ============');
  console.log(`方法: ${parsedData.method}`);
  console.log(`能力: ${parsedData.ability}`);
  console.log(`发送时间: ${parsedData.sendTime}`);
  console.log(`事件数量: ${parsedData.events.length}`);
  
  parsedData.events.forEach((event, index) => {
    console.log(`\n--- 事件 ${index + 1} ---`);
    console.log(`  事件ID: ${event.eventId}`);
    console.log(`  事件类型: ${event.eventType} (${event.eventTypeName})`);
    console.log(`  发生时间: ${event.happenTime}`);
    console.log(`  设备索引: ${event.srcIndex}`);
    console.log(`  设备名称: ${event.srcName}`);
    console.log(`  父级索引: ${event.srcParentIndex}`);
    console.log(`  设备类型: ${event.srcType}`);
    console.log(`  状态: ${event.status}`);
    console.log(`  超时: ${event.timeout}秒`);
  });
  console.log('==========================================\n');
}

// 请求处理函数
function handleRequest(req, res) {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname.toLowerCase().replace(/\/$/, ''); // 转小写并去除尾部斜杠
  
  // 记录所有请求（用于调试）
  console.log(`\n[${new Date().toLocaleString('zh-CN')}] ${req.method} ${parsedUrl.pathname}`);
  console.log(`  来源: ${req.headers['x-forwarded-for'] || req.connection.remoteAddress || 'unknown'}`);
  console.log(`  User-Agent: ${req.headers['user-agent'] || 'unknown'}`);
  
  // 处理 GET 请求 - 返回 HTML 页面
  if (req.method === 'GET' && pathname === '') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(getHTMLPage());
  } 
  // 处理 /eventRcv 路径的请求（支持多种变体）
  else if (pathname === '/eventrcv' || pathname === '/eventrcvl' || pathname === '/eventrcv/') {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });
      
      // 设置超时，避免请求挂起
      req.setTimeout(30000, () => {
        console.log('⚠️  请求超时');
        if (!res.headersSent) {
          res.writeHead(200, { 
            'Content-Type': 'application/json; charset=utf-8',
            'Connection': 'close'
          });
          res.end(JSON.stringify({ 
            code: '0',
            msg: 'success'
          }));
        }
      });
      
      req.on('end', () => {
        console.log(`  收到POST数据，长度: ${body.length} 字节`);
        
        // 立即返回 HTTP/1.1 200 OK，避免事件积压
        // 海康平台要求返回格式：{"code":"0","msg":"success"}
        const response = JSON.stringify({ 
          code: '0',
          msg: 'success'
        });
        
        res.writeHead(200, { 
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Length': Buffer.byteLength(response),
          'Connection': 'close'
        });
        res.end(response);
        console.log('  ✅ 已返回200响应');
        
        // 在后台异步处理数据收集（使用 setImmediate 确保响应先发送）
        setImmediate(() => {
          let parsedBody = body;
          let hikvisionEvent = null;
          
          try {
            parsedBody = JSON.parse(body);
            console.log('  ✅ JSON解析成功');
            
            // 解析海康事件数据
            if (parsedBody && parsedBody.method === 'OnEventNotify') {
              hikvisionEvent = parseHikvisionEvent(parsedBody);
              formatEventDisplay(hikvisionEvent);
            }
          } catch (e) {
            console.log('  ⚠️  JSON解析失败，尝试其他格式:', e.message);
            // 如果不是 JSON，尝试解析为查询字符串
            try {
              parsedBody = querystring.parse(body);
            } catch (e2) {
              // 保持原始字符串
              parsedBody = body;
            }
          }
          
          const requestData = {
            method: 'POST',
            path: parsedUrl.pathname,
            query: parsedUrl.query,
            body: parsedBody,
            rawBody: body,
            headers: req.headers,
            timestamp: new Date().toLocaleString('zh-CN'),
            protocol: req.connection.encrypted ? 'HTTPS' : 'HTTP',
            parsedEvent: hikvisionEvent // 添加解析后的事件数据
          };
          requests.unshift(requestData);
          if (requests.length > 100) requests.pop();
          
          console.log(`  📦 事件数据已保存`);
          
          // 显示简要统计
          if (hikvisionEvent) {
            console.log(`  📊 解析到 ${hikvisionEvent.events.length} 个事件`);
            hikvisionEvent.events.forEach((event, idx) => {
              console.log(`    事件${idx + 1}: ${event.eventTypeName} - ${event.srcName} (${event.happenTime})`);
            });
          } else if (parsedBody && typeof parsedBody === 'object' && parsedBody.params && parsedBody.params.events) {
            const events = parsedBody.params.events;
            console.log(`  📊 事件数量: ${Array.isArray(events) ? events.length : 1}`);
          }
        });
      });
      
      req.on('error', (err) => {
        console.error('  ❌ 请求错误:', err.message);
        if (!res.headersSent) {
          res.writeHead(200, { 
            'Content-Type': 'application/json; charset=utf-8',
            'Connection': 'close'
          });
          res.end(JSON.stringify({ 
            code: '0',
            msg: 'success'
          }));
        }
      });
    } else {
      // 其他方法的请求立即返回
      console.log(`  ⚠️  非POST方法: ${req.method}`);
      const response = JSON.stringify({ 
        code: '0',
        msg: 'success'
      });
      res.writeHead(200, { 
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(response),
        'Connection': 'close'
      });
      res.end(response);
      
      // 在后台记录
      setImmediate(() => {
        const requestData = {
          method: req.method,
          path: parsedUrl.pathname,
          query: parsedUrl.query,
          headers: req.headers,
          timestamp: new Date().toLocaleString('zh-CN'),
          protocol: req.connection.encrypted ? 'HTTPS' : 'HTTP'
        };
        requests.unshift(requestData);
        if (requests.length > 100) requests.pop();
      });
    }
  }
  // 处理其他路径的请求
  else {
    console.log(`  ⚠️  未知路径，返回404`);
    res.writeHead(404, { 
      'Content-Type': 'application/json; charset=utf-8',
      'Connection': 'close'
    });
    res.end(JSON.stringify({ 
      code: '404',
      msg: '路径不存在'
    }, null, 2));
  }
}

// 创建HTTP服务器
const httpServer = http.createServer(handleRequest);

// 尝试创建HTTPS服务器（如果证书存在）
let httpsServer = null;
const HTTPS_PORT = 443;
const HTTP_PORT = 8082;

// 检查证书文件是否存在
const certPath = './cert.pem';
const keyPath = './key.pem';

if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
  try {
    const options = {
      cert: fs.readFileSync(certPath),
      key: fs.readFileSync(keyPath)
    };
    httpsServer = https.createServer(options, handleRequest);
    httpsServer.listen(HTTPS_PORT, () => {
      console.log(`✅ HTTPS服务器运行在 https://localhost:${HTTPS_PORT}`);
      console.log(`   访问 https://localhost:${HTTPS_PORT} 查看请求数据`);
    });
    httpsServer.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`⚠️  HTTPS端口 ${HTTPS_PORT} 已被占用，可能已有反向代理在运行`);
      } else {
        console.error('❌ HTTPS服务器启动失败:', err.message);
      }
    });
  } catch (err) {
    console.error('❌ 加载SSL证书失败:', err.message);
    console.log('   将只启动HTTP服务器');
  }
} else {
  console.log('⚠️  未找到SSL证书文件 (cert.pem, key.pem)');
  console.log('   将只启动HTTP服务器');
  console.log('   如需HTTPS支持，请配置反向代理（如nginx）或提供证书文件');
}

// 启动HTTP服务器
httpServer.listen(HTTP_PORT, () => {
  console.log(`\n✅ HTTP服务器运行在 http://localhost:${HTTP_PORT}`);
  console.log(`   访问 http://localhost:${HTTP_PORT} 查看请求数据`);
  console.log(`\n📌 花生壳配置说明:`);
  console.log(`   1. 外网地址: https://32518bohs147.vicp.fun:443/eventRcv`);
  console.log(`   2. 内网地址: http://localhost:${HTTP_PORT}/eventRcv`);
  console.log(`   3. 请确保花生壳映射: 外网443端口 -> 内网${HTTP_PORT}端口`);
  console.log(`   4. 路径必须包含: /eventRcv`);
  console.log(`\n📝 订阅地址应填写: https://32518bohs147.vicp.fun/eventRcv`);
  console.log(`   (注意: 不要加端口号443，花生壳会自动处理)\n`);
});

httpServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ HTTP端口 ${HTTP_PORT} 已被占用`);
  } else {
    console.error('❌ HTTP服务器启动失败:', err.message);
  }
});

function getHTMLPage() {
  const requestsHTML = requests.map((req, index) => {
    // 如果有解析后的事件数据，优先显示
    const hasParsedEvent = req.parsedEvent && req.parsedEvent.events && req.parsedEvent.events.length > 0;
    
    return `
      <div class="request-item">
        <div class="request-header">
          <span class="method">${req.method}</span>
          <span class="path">${req.path || '/'}</span>
          <span class="protocol">${req.protocol || 'HTTP'}</span>
          <span class="time">${req.timestamp}</span>
        </div>
        ${hasParsedEvent ? `
          <div class="section parsed-event">
            <strong>📊 解析后的事件数据:</strong>
            <div class="event-summary">
              <div><strong>方法:</strong> ${req.parsedEvent.method}</div>
              <div><strong>能力:</strong> ${req.parsedEvent.ability}</div>
              <div><strong>发送时间:</strong> ${req.parsedEvent.sendTime}</div>
              <div><strong>事件数量:</strong> ${req.parsedEvent.events.length}</div>
            </div>
            ${req.parsedEvent.events.map((event, idx) => `
              <div class="event-detail">
                <h4>事件 ${idx + 1}</h4>
                <table>
                  <tr><td>事件ID:</td><td>${event.eventId}</td></tr>
                  <tr><td>事件类型:</td><td>${event.eventType} (${event.eventTypeName})</td></tr>
                  <tr><td>发生时间:</td><td>${event.happenTime}</td></tr>
                  <tr><td>设备名称:</td><td>${event.srcName}</td></tr>
                  <tr><td>设备索引:</td><td>${event.srcIndex}</td></tr>
                  <tr><td>设备类型:</td><td>${event.srcType}</td></tr>
                  <tr><td>父级索引:</td><td>${event.srcParentIndex}</td></tr>
                  <tr><td>状态:</td><td>${event.status}</td></tr>
                  <tr><td>超时:</td><td>${event.timeout}秒</td></tr>
                </table>
              </div>
            `).join('')}
          </div>
        ` : ''}
        ${req.query && Object.keys(req.query).length > 0 ? `
          <div class="section">
            <strong>查询参数:</strong>
            <pre>${JSON.stringify(req.query, null, 2)}</pre>
          </div>
        ` : ''}
        ${req.body ? `
          <div class="section">
            <strong>请求体:</strong>
            <pre>${JSON.stringify(req.body, null, 2)}</pre>
          </div>
        ` : ''}
        ${req.rawBody && req.rawBody !== JSON.stringify(req.body) ? `
          <div class="section">
            <strong>原始数据:</strong>
            <pre>${req.rawBody}</pre>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');

  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>请求数据查看器</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: Arial, sans-serif;
      padding: 20px;
      background: #f5f5f5;
    }
    h1 {
      margin-bottom: 20px;
      color: #333;
    }
    .request-item {
      background: white;
      margin-bottom: 15px;
      padding: 15px;
      border-radius: 5px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    .request-header {
      display: flex;
      gap: 10px;
      margin-bottom: 10px;
      padding-bottom: 10px;
      border-bottom: 1px solid #eee;
    }
    .method {
      background: #007bff;
      color: white;
      padding: 3px 8px;
      border-radius: 3px;
      font-size: 12px;
      font-weight: bold;
    }
    .path {
      color: #666;
      font-family: monospace;
    }
    .protocol {
      background: #28a745;
      color: white;
      padding: 3px 8px;
      border-radius: 3px;
      font-size: 11px;
      font-weight: bold;
    }
    .time {
      color: #999;
      font-size: 12px;
      margin-left: auto;
    }
    .section {
      margin-top: 10px;
    }
    .section strong {
      display: block;
      margin-bottom: 5px;
      color: #333;
    }
    .parsed-event {
      background: #e7f3ff;
      padding: 15px;
      border-radius: 5px;
      border-left: 4px solid #007bff;
      margin-top: 15px;
    }
    .event-summary {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 10px;
      margin: 10px 0;
      padding: 10px;
      background: white;
      border-radius: 3px;
    }
    .event-summary div {
      padding: 5px;
    }
    .event-detail {
      margin-top: 15px;
      padding: 15px;
      background: white;
      border-radius: 5px;
      border: 1px solid #ddd;
    }
    .event-detail h4 {
      margin-bottom: 10px;
      color: #007bff;
    }
    .event-detail table {
      width: 100%;
      border-collapse: collapse;
    }
    .event-detail table td {
      padding: 8px;
      border-bottom: 1px solid #eee;
    }
    .event-detail table td:first-child {
      font-weight: bold;
      width: 120px;
      color: #666;
    }
    .event-detail table td:last-child {
      color: #333;
      font-family: monospace;
    }
    pre {
      background: #f8f8f8;
      padding: 10px;
      border-radius: 3px;
      overflow-x: auto;
      font-size: 13px;
      line-height: 1.5;
    }
    .empty {
      text-align: center;
      color: #999;
      padding: 40px;
    }
  </style>
</head>
<body>
  <h1>请求数据查看器</h1>
  <div id="requests">
    ${requests.length > 0 ? requestsHTML : '<div class="empty">暂无请求数据</div>'}
  </div>
  
  <script>
    // 每2秒自动刷新页面
    setTimeout(() => {
      location.reload();
    }, 2000);
  </script>
</body>
</html>
  `;
}


