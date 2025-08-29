<const express = require('express');
const multer = require('multer');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// 配置CORS - 允许所有来源（生产环境应限制具体域名）
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'DELETE'],
    allowedHeaders: ['Content-Type']
}));

// 解析JSON请求体
app.use(express.json());

// 配置文件存储目录
const uploadDir = path.join(__dirname, 'uploads');
const filesDBPath = path.join(__dirname, 'files.json');

// 初始化 - 确保目录和文件存在
async function initialize() {
    try {
        // 检查并创建上传目录
        if (!fsSync.existsSync(uploadDir)) {
            await fs.mkdir(uploadDir, { recursive: true });
            console.log('创建上传目录:', uploadDir);
        }
        
        // 检查并创建文件数据库
        if (!fsSync.existsSync(filesDBPath)) {
            await fs.writeFile(filesDBPath, JSON.stringify([]));
            console.log('创建文件数据库:', filesDBPath);
        }
        
        console.log('初始化完成');
    } catch (error) {
        console.error('初始化失败:', error);
        process.exit(1); // 初始化失败则退出
    }
}

// 配置multer存储
const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
        try {
            // 确保上传目录存在
            await fs.access(uploadDir);
            cb(null, uploadDir);
        } catch (error) {
            cb(new Error('上传目录不存在'), null);
        }
    },
    filename: (req, file, cb) => {
        // 保留原始文件扩展名
        const ext = path.extname(file.originalname);
        // 使用UUID作为文件名，避免冲突
        const filename = `${uuidv4()}${ext}`;
        cb(null, filename);
    }
});

// 文件过滤 - 只允许特定类型
const fileFilter = (req, file, cb) => {
    const allowedTypes = [
        // Word文档
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        // PDF
        'application/pdf',
        // Excel
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        // 图片
        'image/jpeg',
        'image/png',
        // 文本
        'text/plain'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('不支持的文件类型，仅支持Word、PDF、Excel、图片和文本文件'), false);
    }
};

// 配置multer上传
const upload = multer({ 
    storage: storage,
    fileFilter: fileFilter,
    limits: { 
        fileSize: 50 * 1024 * 1024, // 限制50MB
        files: 10 // 一次最多上传10个文件
    }
});

// 读取文件数据库
async function readFilesDB() {
    try {
        const data = await fs.readFile(filesDBPath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('读取文件数据库失败:', error);
        return [];
    }
}

// 写入文件数据库
async function writeFilesDB(data) {
    try {
        await fs.writeFile(filesDBPath, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error('写入文件数据库失败:', error);
        return false;
    }
}

// 获取文件列表
app.get('/files', async (req, res) => {
    try {
        const files = await readFilesDB();
        res.json(files);
    } catch (error) {
        console.error('获取文件列表错误:', error);
        res.status(500).json({ error: '获取文件列表失败，请稍后再试' });
    }
});

// 上传文件
app.post('/upload', upload.array('files'), async (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: '没有选择要上传的文件' });
        }
        
        // 读取现有文件列表
        const files = await readFilesDB();
        
        // 添加新文件信息
        const newFiles = req.files.map(file => ({
            id: uuidv4(),
            name: file.originalname,
            filename: file.filename,
            size: file.size,
            mimetype: file.mimetype,
            uploadedAt: new Date().toISOString()
        }));
        
        // 合并并保存
        const updatedFiles = [...files, ...newFiles];
        const writeSuccess = await writeFilesDB(updatedFiles);
        
        if (!writeSuccess) {
            return res.status(500).json({ error: '保存文件信息失败，请稍后再试' });
        }
        
        res.json({ 
            message: '文件上传成功', 
            count: newFiles.length,
            files: newFiles
        });
    } catch (error) {
        console.error('文件上传错误:', error);
        res.status(500).json({ error: `上传失败: ${error.message || '服务器错误'}` });
    }
});

// 下载文件
app.get('/download/:id', async (req, res) => {
    try {
        const fileId = req.params.id;
        const files = await readFilesDB();
        const file = files.find(f => f.id === fileId);
        
        if (!file) {
            return res.status(404).json({ error: '文件不存在或已被删除' });
        }
        
        const filePath = path.join(uploadDir, file.filename);
        
        // 检查文件是否存在
        try {
            await fs.access(filePath);
        } catch (error) {
            return res.status(404).json({ error: '文件不存在或已被删除' });
        }
        
        // 设置响应头，指定文件名（支持中文）
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.name)}"`);
        res.setHeader('Content-Type', file.mimetype || 'application/octet-stream');
        
        // 发送文件
        res.sendFile(filePath, (error) => {
            if (error) {
                console.error('文件下载错误:', error);
                if (!res.headersSent) {
                    res.status(500).json({ error: '文件下载失败，请稍后再试' });
                }
            }
        });
    } catch (error) {
        console.error('下载请求处理错误:', error);
        res.status(500).json({ error: '下载文件失败，请稍后再试' });
    }
});

// 删除文件
app.delete('/delete/:id', async (req, res) => {
    try {
        const fileId = req.params.id;
        const files = await readFilesDB();
        const fileIndex = files.findIndex(f => f.id === fileId);
        
        if (fileIndex === -1) {
            return res.status(404).json({ error: '文件不存在或已被删除' });
        }
        
        // 获取要删除的文件信息
        const fileToDelete = files[fileIndex];
        const filePath = path.join(uploadDir, fileToDelete.filename);
        
        // 从数组中移除文件信息
        const updatedFiles = [...files.slice(0, fileIndex), ...files.slice(fileIndex + 1)];
        const writeSuccess = await writeFilesDB(updatedFiles);
        
        if (!writeSuccess) {
            return res.status(500).json({ error: '更新文件列表失败，请稍后再试' });
        }
        
        // 删除实际文件
        try {
            await fs.unlink(filePath);
        } catch (error) {
            console.warn('删除文件时警告:', error.message);
            // 即使文件删除失败，也返回成功，因为数据库已更新
        }
        
        res.json({ message: '文件已成功删除' });
    } catch (error) {
        console.error('删除文件错误:', error);
        res.status(500).json({ error: '删除文件失败，请稍后再试' });
    }
});

// 静态文件服务（用于前端页面）
app.use(express.static(path.join(__dirname, 'public')));

// 根路径重定向到前端页面
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 错误处理中间件
app.use((err, req, res, next) => {
    console.error('服务器错误:', err);
    
    // 处理multer错误
    if (err instanceof multer.MulterError) {
        if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ error: '文件过大，最大支持50MB' });
        }
        if (err.code === 'LIMIT_FILE_COUNT') {
            return res.status(400).json({ error: '文件数量过多，一次最多上传10个文件' });
        }
        return res.status(400).json({ error: `上传错误: ${err.message}` });
    }
    
    // 处理其他错误
    res.status(500).json({ error: err.message || '服务器内部错误，请稍后再试' });
});

// 启动服务器
initialize().then(() => {
    app.listen(PORT, () => {
        console.log(`服务器运行在 http://localhost:${PORT}`);
        console.log(`文件存储目录: ${uploadDir}`);
    });
});
