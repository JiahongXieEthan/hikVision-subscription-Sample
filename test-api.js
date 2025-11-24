const https = require('https');
const crypto = require('crypto');

// ============ 配置信息 ============
// 从命令行参数获取 appKey 和 appSecret
const args = process.argv.slice(2);
const appKeyIndex = args.indexOf('--appKey');
const appSecretIndex = args.indexOf('--appSecret');

if (appKeyIndex === -1 || appKeyIndex === args.length - 1 || 
    appSecretIndex === -1 || appSecretIndex === args.length - 1) {
    console.error('❌ 错误: 请提供 appKey 和 appSecret 参数');
    console.error('使用方法: node test-api.js --appKey <your-app-key> --appSecret <your-app-secret>');
    process.exit(1);
}

const appKey = args[appKeyIndex + 1];
const appSecret = args[appSecretIndex + 1];
const url = 'https://labull.hsk.top:1443/artemis/api/eventService/v1/eventSubscriptionByEventTypes';

// ============ 请求数据 ============
const requestBody = {
    "eventTypes": [196893],
    "eventDest": "https://32518bohs147.vicp.fun/eventRcv"
};
const bodyString = JSON.stringify(requestBody);

// ============ 生成签名信息 ============
const method = 'POST';
const timestamp = Date.now().toString();
const nonce = crypto.randomBytes(16).toString('hex');

const urlObj = new URL(url);
const path = urlObj.pathname;
const query = urlObj.search ? urlObj.search.substring(1) : '';

// 计算Content-MD5（body的MD5值，Base64编码）
const contentMD5 = crypto.createHash('md5').update(bodyString, 'utf8').digest('base64');

// 构建请求headers
const headers = {
    'Accept': '*/*',
    'Content-Type': 'application/json',
    'Content-MD5': contentMD5,
    'X-Ca-Key': appKey,
    'X-Ca-Timestamp': timestamp,
    'X-Ca-Nonce': nonce
};

// 参与签名的headers（排除特殊header，key转小写，按字典序排序）
const excludeHeaders = ['x-ca-signature', 'x-ca-signature-headers', 'accept', 'content-md5', 
                        'content-type', 'date', 'content-length', 'server', 'connection', 
                        'host', 'transfer-encoding', 'x-application-context', 'content-encoding'];
const signHeaders = {};
Object.keys(headers).forEach(key => {
    const lowerKey = key.toLowerCase();
    if (!excludeHeaders.includes(lowerKey)) {
        signHeaders[lowerKey] = headers[key].trim();
    }
});

// 构建签名字符串
const signHeaderKeys = Object.keys(signHeaders).sort();
const signHeaderString = signHeaderKeys.map(key => `${key}:${signHeaders[key]}`).join('\n');
const signUrl = query ? `${path}?${query}` : path;

// 按顺序构建签名字符串（如果header不存在则不添加换行符）
const signParts = [method];
if (headers['Accept']) signParts.push(headers['Accept']);
if (contentMD5) signParts.push(contentMD5);
if (headers['Content-Type']) signParts.push(headers['Content-Type']);
if (headers['Date']) signParts.push(headers['Date']);
// Headers部分和URL之间用换行符连接，URL前不需要额外换行符
const signString = signParts.join('\n') + '\n' + signHeaderString + '\n' + signUrl;

// 计算签名
const signature = crypto.createHmac('sha256', appSecret).update(signString, 'utf8').digest('base64');

// 添加签名相关headers
headers['X-Ca-Signature'] = signature;
headers['X-Ca-Signature-Headers'] = signHeaderKeys.join(',');
headers['Content-Length'] = Buffer.byteLength(bodyString);

console.log('签名字符串:\n' + signString.replace(/\n/g, '\\n\n'));
console.log('签名:', signature);
console.log('X-Ca-Signature-Headers:', headers['X-Ca-Signature-Headers']);
console.log('\n正在发送请求...\n');

// ============ 发送请求 ============
const options = {
    hostname: urlObj.hostname,
    port: urlObj.port || 443,
    path: path + (query ? '?' + query : ''),
    method: method,
    headers: headers,
    rejectUnauthorized: false
};

const req = https.request(options, (res) => {
    console.log('状态码:', res.statusCode);
    console.log('响应 Headers:', JSON.stringify(res.headers, null, 2));
    
    let responseData = '';
    res.on('data', (chunk) => responseData += chunk);
    res.on('end', () => {
        try {
            console.log('响应内容:', JSON.stringify(JSON.parse(responseData), null, 2));
        } catch (e) {
            console.log('响应内容:', responseData);
        }
        console.log(res.statusCode === 200 ? '\n✅ 请求成功！' : '\n❌ 请求失败');
    });
});

req.on('error', (error) => console.error('❌ 请求错误:', error));
req.write(bodyString);
req.end();
