const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { startMonitoring } = require('./image-monitor');

// 保持对窗口对象的全局引用，避免JavaScript对象被垃圾回收时窗口关闭
let mainWindow;

// 日志相关设置
const logDir = path.join(app.getPath('userData'), 'logs');
const logFile = path.join(logDir, `print-log-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`);

// 确保日志目录存在
function ensureLogDir() {
  if (!fs.existsSync(logDir)) {
    try {
      fs.mkdirSync(logDir, { recursive: true });
      logMessage('日志目录创建成功: ' + logDir, __filename, 16);
    } catch (err) {
      console.error('创建日志目录失败:', err);
    }
  }
}

// 写入日志
function logMessage(message, file = '', line = 0) {
  const timestamp = new Date().toISOString();
  const fileName = file ? path.basename(file) : 'unknown';
  const lineInfo = line ? `:${line}` : '';
  const sourceInfo = `[${fileName}${lineInfo}]`;
  const logEntry = `[${timestamp}] ${sourceInfo} ${message}\n`;
  
  // 输出到控制台
  console.log(`${sourceInfo} ${message}`);
  
  // 写入日志文件
  try {
    fs.appendFileSync(logFile, logEntry);
  } catch (err) {
    console.error('写入日志失败:', err);
  }
}

function createWindow() {
  logMessage('创建应用窗口', __filename, 44);
  
  // 创建浏览器窗口
  mainWindow = new BrowserWindow({
    width: 600,
    height: 400,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  // 加载应用的index.html
  mainWindow.loadURL('https://avatar.migudm.cn/prefe/test_portal_home/');
  
  logMessage('应用窗口已加载', __filename, 58);

  // 启动图片监测
  startMonitoring(mainWindow);
  logMessage('图片监测已启动', __filename, 61);

  // 当窗口关闭时触发
  mainWindow.on('closed', function () {
    logMessage('应用窗口已关闭', __filename, 65);
    mainWindow = null;
  });
}

// 当Electron完成初始化并准备创建浏览器窗口时调用此方法
app.whenReady().then(() => {
  logMessage('应用启动', __filename, 69);
  ensureLogDir();
  createWindow();
});

// 当所有窗口关闭时退出应用
app.on('window-all-closed', function () {
  logMessage('所有窗口已关闭', __filename, 76);
  if (process.platform !== 'darwin') {
    logMessage('应用退出', __filename, 78);
    app.quit();
  }
});

app.on('activate', function () {
  if (mainWindow === null) {
    logMessage('应用激活，重新创建窗口', __filename, 85);
    createWindow();
  }
});

// 监听渲染进程发送的选择照片请求
ipcMain.on('select-photos', async (event) => {
  logMessage('用户请求选择照片', __filename, 92);
  
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: '图片', extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp'] }
    ]
  });
  
  if (!result.canceled) {
    logMessage(`用户选择了 ${result.filePaths.length} 张照片`, __filename, 102);
    
    // 只返回选择的照片路径，不自动打印
    event.reply('photos-selected', result.filePaths);
  } else {
    logMessage('用户取消了照片选择', __filename, 107);
  }
});

// 监听重新打印请求
ipcMain.on('reprint-photos', async (event, filePaths) => {
  logMessage(`收到打印请求，共 ${filePaths.length} 张照片`, __filename, 113);
  
  // 逐个打印选择的照片
  for (const filePath of filePaths) {
    logMessage(`准备打印照片: ${path.basename(filePath)}`, __filename, 117);
    printPhoto(filePath, event);
  }
});

// 打印照片函数
async function printPhoto(filePath, event) {
  try {
    logMessage(`开始处理照片: ${path.basename(filePath)}`, __filename, 125);
    
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

    logMessage(`为照片 ${path.basename(filePath)} 创建打印窗口`, __filename, 137);
    
    // 加载专门用于打印的HTML
    printWindow.loadFile('print.html');

    // 等待页面加载完成
    printWindow.webContents.on('did-finish-load', () => {
      logMessage(`打印页面已加载，准备渲染照片: ${path.basename(filePath)}`, __filename, 144);
      // 将图片路径发送到打印页面
      printWindow.webContents.send('print-image', filePath);
    });

    // 监听打印页面准备好打印的信号
    ipcMain.once('ready-to-print', () => {
      logMessage(`照片 ${path.basename(filePath)} 已渲染，开始打印`, __filename, 151);
      
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
          logMessage(`照片 ${path.basename(filePath)} 打印成功`, __filename, 163);
          event.reply('print-complete', { success: true, filePath });
        } else {
          logMessage(`照片 ${path.basename(filePath)} 打印失败: ${failureReason}`, __filename, 166);
          event.reply('print-complete', { success: false, filePath, error: failureReason });
        }
        
        // 关闭打印窗口
        printWindow.close();
        logMessage(`照片 ${path.basename(filePath)} 的打印窗口已关闭`, __filename, 172);
      });
    });
  } catch (error) {
    logMessage(`照片 ${path.basename(filePath)} 处理过程出错: ${error.message}`, __filename, 176);
    event.reply('print-complete', { success: false, filePath, error: error.message });
  }
} 