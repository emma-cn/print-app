const { BrowserWindow, session } = require('electron');
const path = require('path');
const fs = require('fs');

// 全局变量存储最新图片路径
global.latestImageUrl = null;

// 监测的目标URL
const TARGET_URLS = {
  IMAGE: 'https://avatar.migudm.cn/staticres/portalx/ai/changeFace',
  PRINT: '/print'
};

// 存储监听器的引用，用于清理
let webRequestListener = null;
let beforeRequestListener = null;
let scriptInjected = false;

// 日志相关函数
function logMessage(message, data = null) {
  const timestamp = new Date().toISOString();
  const logEntry = data 
    ? `[${timestamp}] [image-monitor] ${message}\nData: ${JSON.stringify(data, null, 2)}`
    : `[${timestamp}] [image-monitor] ${message}`;
  
  console.log(logEntry);
  
  try {
    const logDir = path.join(process.env.APPDATA || process.env.HOME, '.print-temp', 'logs');
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    
    const logFile = path.join(logDir, `image-monitor-${new Date().toISOString().split('T')[0]}.log`);
    fs.appendFileSync(logFile, logEntry + '\n');
  } catch (err) {
    console.error('写入日志失败:', err);
  }
}

// 清理监听器
function cleanupMonitoring() {
  if (webRequestListener) {
    session.defaultSession.webRequest.removeListener('completed', webRequestListener);
    webRequestListener = null;
  }
  if (beforeRequestListener) {
    session.defaultSession.webRequest.removeListener('beforeRequest', beforeRequestListener);
    beforeRequestListener = null;
  }
  logMessage('已清理网络请求监听器');
  scriptInjected = false;
}

// 启动监测
function startMonitoring(mainWindow) {
  // 先清理之前的监听器
  cleanupMonitoring();
  
  logMessage('开始监测网络请求');
  
  // 监听请求完成事件
  webRequestListener = (details) => {
    // 监测图片请求
    if (details.method === 'GET' && details.statusCode === 200) {
      if (details.url.includes(TARGET_URLS.IMAGE)) {
        logMessage('检测到目标图片请求', {
          url: details.url,
          method: details.method,
          statusCode: details.statusCode,
          timestamp: new Date().toISOString()
        });
        
        // 存储图片URL
        global.latestImageUrl = details.url;
        
        // 检测到图片后立即自动打印
        logMessage('自动打印模式，开始下载并打印图片');
        
        // 检查窗口是否有效
        if (mainWindow && !mainWindow.isDestroyed()) {
          // 创建一个隐藏的窗口来打印图片
          // printDetectedImage(details.url, mainWindow);
        } else {
          logMessage('主窗口无效，无法打印');
        }
      }
    }
  };

  // 监听请求开始事件
  beforeRequestListener = (details, callback) => {
    // 监测POST打印请求
    if (details.method === 'POST' && details.url.includes(TARGET_URLS.PRINT)) {
      logMessage('检测到打印请求，模拟成功响应', {
        url: details.url,
        method: details.method,
        headers: details.requestHeaders,
        timestamp: new Date().toISOString()
      });
      
      // 存储最新的打印请求信息
      global.latestPrintRequest = {
        url: details.url,
        timestamp: new Date().toISOString(),
        requestId: details.id,
        headers: details.requestHeaders
      };

      // 如果有最近监测到的图片URL，发送打印请求
      if (global.latestImageUrl) {
        try {
          // 确保 mainWindow 存在且有效
          if (mainWindow && !mainWindow.isDestroyed()) {
            printDetectedImage(global.latestImageUrl, mainWindow)
            logMessage('打印请求已发送');
          } else {
            logMessage('打印请求失败：主窗口无效');
          }
        } catch (error) {
          logMessage('发送打印请求时出错', {
            error: error.message,
            stack: error.stack
          });
        }
      }

      // 重定向到本地成功响应
      callback({
        redirectURL: 'data:application/json;base64,eyJzdGF0dXMiOiJPSyJ9'  // base64 编码的 {"status":"OK"}
      });
      return;
    }
    
    // 其他请求正常放行
    callback({
      cancel: false
    });
  };
  
  // 添加请求头监听器
  session.defaultSession.webRequest.onBeforeSendHeaders({
    urls: [
      '*://*/print*',  // 监听所有域名的 /print 路径
      'http://*/print*',
      'https://*/print*'
    ]
  }, (details, callback) => {
    if (details.method === 'POST' && details.url.includes(TARGET_URLS.PRINT)) {
      // 修改请求头，添加自定义标记
      details.requestHeaders['X-Custom-Response'] = 'true';
      callback({ requestHeaders: details.requestHeaders });
      return;
    }
    callback({ requestHeaders: details.requestHeaders });
  });
  
  // 添加响应头监听器
  session.defaultSession.webRequest.onHeadersReceived({
    urls: [
      '*://*/print*',  // 监听所有域名的 /print 路径
      'http://*/print*',
      'https://*/print*'
    ]
  }, (details, callback) => {
    if (details.method === 'POST' && details.url.includes(TARGET_URLS.PRINT)) {
      logMessage('修改打印请求响应状态为200', {
        url: details.url,
        method: details.method,
        timestamp: new Date().toISOString()
      });

      // 修改响应头
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'content-type': ['application/json'],
          'status': ['200']
        },
        statusLine: 'HTTP/1.1 200 OK'
      });
      return;
    }
    
    callback({ responseHeaders: details.responseHeaders });
  });
  
  // 添加请求结束监听器
  session.defaultSession.webRequest.onCompleted({
    urls: [
      '*://*/print*',  // 监听所有域名的 /print 路径
      'http://*/print*',
      'https://*/print*',
      `${TARGET_URLS.IMAGE}*`  // 监听图片请求
    ]
  }, (details) => {
    // 处理打印请求
    if (details.method === 'POST' && details.url.includes(TARGET_URLS.PRINT)) {
      logMessage('打印请求已完成', {
        url: details.url,
        method: details.method,
        statusCode: details.statusCode,
        timestamp: new Date().toISOString(),
        fromCache: details.fromCache,
        responseHeaders: details.responseHeaders
      });
    }
    // 处理图片请求
    else if (details.method === 'GET' && details.statusCode === 200 && details.url.includes(TARGET_URLS.IMAGE)) {
      logMessage('检测到目标图片请求', {
        url: details.url,
        method: details.method,
        statusCode: details.statusCode,
        timestamp: new Date().toISOString()
      });
      
      // 存储图片URL
      global.latestImageUrl = details.url;
      
      // 检测到图片后立即自动打印
      logMessage('自动打印模式，开始下载并打印图片');
      
      // 检查窗口是否有效
      if (mainWindow && !mainWindow.isDestroyed()) {
        // 创建一个隐藏的窗口来打印图片
        // printDetectedImage(details.url, mainWindow);
      } else {
        logMessage('主窗口无效，无法打印');
      }
    }
  });
  
  // 设置请求监听
  session.defaultSession.webRequest.onBeforeRequest({
    urls: [
      '*://*/print*',  // 监听所有域名的 /print 路径
      'http://*/print*',
      'https://*/print*'
    ]
  }, beforeRequestListener);
  
  // 监听打印结果
  mainWindow.webContents.on('ipc-message', (event, channel, ...args) => {
    logMessage('收到IPC消息', {
      channel,
      args,
      timestamp: new Date().toISOString()
    });
  });
  
  // 监听窗口关闭事件，清理监听器
  mainWindow.on('closed', () => {
    cleanupMonitoring();
  });
}

// 新增打印检测到的图片函数
function printDetectedImage(imageUrl, mainWindow) {
  try {
    logMessage(`开始处理图片打印: ${imageUrl}`);
    
    // 创建一个隐藏的窗口来加载和打印图片
    const printWindow = new BrowserWindow({
      width: 800,
      height: 600,
      show: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false
      }
    });

    // 加载专门用于打印的HTML
    printWindow.loadFile('print.html');

    // 等待页面加载完成
    printWindow.webContents.on('did-finish-load', () => {
      logMessage(`打印页面已加载，准备打印图片`);
      
      // 将图片URL发送到打印页面
      printWindow.webContents.send('print-detected-image', imageUrl);
    });

    // 监听打印页面准备好打印的信号
    require('electron').ipcMain.once('ready-to-print-detected', () => {
      logMessage(`图片已渲染，开始直接打印`);
      
      // 直接打印，不显示打印对话框
      printWindow.webContents.print({ 
        silent: true,
        printBackground: true,
        color: true,
        margins: {
          marginType: 'none'
        }
      }, (success, failureReason) => {
        if (success) {
          logMessage(`图片打印成功`);
          // 通知主窗口打印成功
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('auto-print-complete', { 
              success: true, 
              imageUrl: imageUrl 
            });
          }
        } else {
          logMessage(`图片打印失败: ${failureReason}`);
          // 通知主窗口打印失败
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('auto-print-complete', { 
              success: false, 
              imageUrl: imageUrl,
              error: failureReason 
            });
          }
        }
        
        // 关闭打印窗口
        printWindow.close();
        logMessage(`打印窗口已关闭`);
      });
    });
  } catch (error) {
    logMessage(`处理图片打印过程出错: ${error.message}`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('auto-print-complete', { 
        success: false, 
        imageUrl: imageUrl,
        error: error.message 
      });
    }
  }
}

module.exports = {
  startMonitoring,
  cleanupMonitoring
}; 