# 海康威视事件订阅服务

这是一个用于接收和处理海康威视设备事件推送的 Node.js 服务。

## 文件说明

- `server.js` - HTTP/HTTPS 服务器，用于接收海康威视的事件推送
- `test-api.js` - 测试脚本：订阅事件
- `test-query-subscription.js` - 测试脚本：查询当前订阅
- `test-unsubscribe-all.js` - 测试脚本：取消所有订阅

## 环境要求

- Node.js (建议 v12 或更高版本)

## 安装

无需安装额外依赖，项目使用 Node.js 内置模块。

## 使用方法

### 1. 启动服务器

```bash
node server.js
```

服务器将在以下端口启动：
- **HTTP**: `http://localhost:8082`
- **HTTPS**: `https://localhost:443` (如果存在证书文件 `cert.pem` 和 `key.pem`)

访问 `http://localhost:8082` 可以查看接收到的所有请求数据。

### 2. 订阅事件

```bash
node test-api.js --appKey <你的AppKey> --appSecret <你的AppSecret>
```

示例：
```bash
node test-api.js --appKey 1111111 --appSecret 1111111111
```

### 3. 查询订阅

```bash
node test-query-subscription.js --appKey <你的AppKey> --appSecret <你的AppSecret>
```

### 4. 取消所有订阅

```bash
node test-unsubscribe-all.js --appKey <你的AppKey> --appSecret <你的AppSecret>
```

## 配置说明

### API 密钥

**重要**: 所有测试脚本都需要通过命令行参数提供 `appKey` 和 `appSecret`，不会硬编码在代码中。

参数格式：
- `--appKey <你的AppKey>`
- `--appSecret <你的AppSecret>`

### 事件接收地址

默认事件接收地址配置在 `test-api.js` 中：
```javascript
"eventDest": "https://32518bohs147.vicp.fun/eventRcv"
```

如需修改，请编辑 `test-api.js` 文件中的 `requestBody.eventDest` 字段。

### HTTPS 支持

如果需要 HTTPS 支持，请在项目根目录放置以下证书文件：
- `cert.pem` - SSL 证书
- `key.pem` - SSL 私钥

如果证书文件不存在，服务器将只启动 HTTP 服务。

## 功能特性

- ✅ 接收海康威视事件推送
- ✅ 自动解析事件数据
- ✅ Web 界面查看请求历史
- ✅ 支持 HTTP 和 HTTPS
- ✅ 命令行参数配置 API 密钥（安全）

## 注意事项

1. 确保服务器运行后，再执行订阅操作
2. 事件接收地址必须是公网可访问的 URL
3. 如果使用内网穿透（如花生壳），请确保映射配置正确
4. API 密钥请妥善保管，不要提交到代码仓库

## 问题排查

### 服务器无法启动

- 检查端口是否被占用（默认 8082）
- 检查防火墙设置

### 事件无法接收

- 确认服务器正在运行
- 检查事件接收地址是否正确配置
- 确认网络连接正常
- 检查订阅是否成功（使用 `test-query-subscription.js`）

### 订阅失败

- 确认 API Key 和 Secret 正确
- 检查网络连接
- 查看控制台错误信息

