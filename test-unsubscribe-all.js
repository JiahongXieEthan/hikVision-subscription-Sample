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
    console.error('使用方法: node test-unsubscribe-all.js --appKey <your-app-key> --appSecret <your-app-secret>');
    process.exit(1);
}

const appKey = args[appKeyIndex + 1];
const appSecret = args[appSecretIndex + 1];
const baseUrl = 'https://labull.hsk.top:1443/artemis';

// ============ 通用函数：发送签名请求 ============
function sendSignedRequest(url, requestBody, description) {
    return new Promise((resolve, reject) => {
        const bodyString = JSON.stringify(requestBody);
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

        console.log(`\n============ ${description} ============`);
        console.log('接口地址:', url);
        console.log('请求体:', bodyString);
        console.log('签名字符串:\n' + signString.replace(/\n/g, '\\n\n'));
        console.log('签名:', signature);
        console.log('X-Ca-Signature-Headers:', headers['X-Ca-Signature-Headers']);
        console.log('\n正在发送请求...\n');

        // 发送请求
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
            
            let responseData = '';
            res.on('data', (chunk) => responseData += chunk);
            res.on('end', () => {
                try {
                    const jsonData = JSON.parse(responseData);
                    console.log('响应内容:', JSON.stringify(jsonData, null, 2));
                    
                    if (res.statusCode === 200) {
                        console.log('✅ 请求成功！');
                        resolve(jsonData);
                    } else {
                        console.log('❌ 请求失败');
                        reject(new Error(`请求失败: ${jsonData.msg || responseData}`));
                    }
                } catch (e) {
                    console.log('响应内容:', responseData);
                    if (res.statusCode === 200) {
                        resolve(responseData);
                    } else {
                        reject(new Error(`请求失败: ${responseData}`));
                    }
                }
            });
        });

        req.on('error', (error) => {
            console.error('❌ 请求错误:', error);
            reject(error);
        });
        
        req.write(bodyString);
        req.end();
    });
}

// ============ 主流程 ============
async function main() {
    try {
        // 步骤1: 查询所有订阅
        console.log('============ 开始流程：查询并取消所有订阅 ============');
        const queryUrl = `${baseUrl}/api/eventService/v1/eventSubscriptionView`;
        const queryResult = await sendSignedRequest(queryUrl, {}, '查询事件订阅信息');

        // 步骤2: 提取所有事件类型
        if (queryResult.code !== '0' || !queryResult.data || !queryResult.data.detail) {
            console.log('\n❌ 查询失败或没有订阅信息');
            return;
        }

        const allEventTypes = new Set();
        queryResult.data.detail.forEach((item) => {
            if (item.eventTypes && Array.isArray(item.eventTypes)) {
                item.eventTypes.forEach(eventType => allEventTypes.add(eventType));
            }
        });

        const eventTypesArray = Array.from(allEventTypes);
        
        if (eventTypesArray.length === 0) {
            console.log('\n✅ 没有需要取消的订阅');
            return;
        }

        console.log('\n============ 提取到的事件类型 ============');
        console.log('事件类型列表:', eventTypesArray);
        console.log('共', eventTypesArray.length, '个事件类型需要取消订阅');

        // 步骤3: 取消所有订阅
        const unsubscribeUrl = `${baseUrl}/api/eventService/v1/eventUnSubscriptionByEventTypes`;
        const unsubscribeResult = await sendSignedRequest(
            unsubscribeUrl, 
            { eventTypes: eventTypesArray }, 
            '取消事件订阅'
        );

        if (unsubscribeResult.code === '0') {
            console.log('\n✅ 所有订阅已成功取消！');
        } else {
            console.log('\n❌ 取消订阅失败:', unsubscribeResult.msg);
        }

    } catch (error) {
        console.error('\n❌ 流程执行失败:', error.message);
    }
}

// 执行主流程
main();



