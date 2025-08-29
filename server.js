<const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = 3000;

// 启用CORS
app.use(cors());

// 确保uploads文件夹存在
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

// 配置multer存储
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
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
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/pdf',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'image/jpeg',
        'image/png',
        'text/plain'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('不支持的文件类型'), false);
    }
};

const upload = multer({ 
    storage: storage,
    fileFilter: fileFilter,
    limits: { fileSize: 50 * 1024 * 1024 } // 限制50MB
});

// 存储文件信息的JSON文件
const filesDB = path.join(__dirname, 'files.json');

// 初始化文件数据库
if (!fs.existsSync(filesDB)) {
    fs.writeFileSync(filesDB, JSON.stringify([]));
}

// 获取文件列表
app.get('/files', (req, res) => {
    try {
        const files = JSON.parse(fs.readFileSync(filesDB, 'utf8'));
        res.json(files);
    } catch (error) {
        res.status(500).json({ error: '获取文件列表失败' });
    }
});

// 上传文件
app.post('/upload', upload.array('files'), (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: '没有文件被上传' });
        }
        
        // 读取现有文件列表
        const files = JSON.parse(fs.readFileSync(filesDB, 'utf8'));
        
        // 添加新文件信息
        req.files.forEach(file => {
            files.push({
                id: uuidv4(),
                name: file.originalname,
                filename: file.filename,
                size: file.size,
                uploadedAt: new Date().toISOString()
            });
        });
        
        // 保存更新后的文件列表
        fs.writeFileSync(filesDB, JSON.stringify(files, null, 2));
        
        res.json({ message: '文件上传成功', count: req.files.length });
    } catch (error) {
        res.status(500).json({ error: '文件上传失败' });
    }
});

// 下载文件
app.get('/download/:id', (req, res) => {
    try {
        const files = JSON.parse(fs.readFileSync(filesDB, 'utf8'));
        const file = files.find(f => f.id === req.params.id);
        
        if (!file) {
            return res.status(404).json({ error: '文件不存在' });
        }
        
        const filePath = path.join(uploadDir, file.filename);
        
        // 检查文件是否存在
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: '文件不存在' });
        }
        
        // 设置响应头，指定文件名
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.name)}"`);
        // 发送文件
        res.sendFile(filePath);
    } catch (error) {
        res.status(500).json({ error: '文件下载失败' });
    }
});

// 删除文件
app.delete('/delete/:id', (req, res) => {
    try {
        const files = JSON.parse(fs.readFileSync(filesDB, 'utf8'));
        const fileIndex = files.findIndex(f => f.id === req.params.id);
        
        if (fileIndex === -1) {
            return res.status(404).json({ error: '文件不存在' });
        }
        
        // 获取要删除的文件信息
        const fileToDelete = files[fileIndex];
        const filePath = path.join(uploadDir, fileToDelete.filename);
        
        // 从数组中移除文件信息
        files.splice(fileIndex, 1);
        fs.writeFileSync(filesDB, JSON.stringify(files, null, 2));
        
        // 删除实际文件
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        
        res.json({ message: '文件已删除' });
    } catch (error) {
        res.status(500).json({ error: '文件删除失败' });
    }
});

// 静态文件服务（用于前端页面）
app.use(express.static(path.join(__dirname, 'public')));

// 启动服务器
app.listen(PORT, () => {
    console.log(`服务器运行在 http://localhost:${PORT}`);
    console.log('文件上传目录:', uploadDir);
});
