const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;

// In-memory storage (will be replaced with database later)
let users = [];
let documents = [];
let nextUserId = 1;
let nextDocId = 1;

// Security middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "blob:"],
            connectSrc: ["'self'"]
        }
    }
}));

app.use(compression());
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Initialize default admin user
async function initializeAdmin() {
    if (users.length === 0) {
        const hashedPassword = await bcrypt.hash('Teacher123!@#', 12);
        users.push({
            id: nextUserId++,
            email: 'admin@teacher.com',
            password_hash: hashedPassword,
            first_name: 'Math',
            last_name: 'Teacher',
            role: 'admin',
            is_active: true,
            created_at: new Date()
        });
        console.log('✅ Default admin user created: admin@teacher.com / Teacher123!@#');
    }
}

// Authentication middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'math-teacher-secret-key');
        const user = users.find(u => u.id === decoded.userId && u.is_active);
        
        if (!user) {
            return res.status(401).json({ error: 'User not found' });
        }

        req.user = user;
        next();
    } catch (error) {
        return res.status(403).json({ error: 'Invalid token' });
    }
};

// Routes

// Health check
app.get('/api/health', (req, res) => {
    res.json({
        status: 'OK',
        message: 'Math Teacher Document System is running!',
        timestamp: new Date().toISOString(),
        users: users.length,
        documents: documents.length
    });
});

// Login
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }

        const user = users.find(u => u.email === email && u.is_active);
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const isValidPassword = await bcrypt.compare(password, user.password_hash);
        if (!isValidPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign(
            { userId: user.id, email: user.email },
            process.env.JWT_SECRET || 'math-teacher-secret-key',
            { expiresIn: '24h' }
        );

        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                email: user.email,
                first_name: user.first_name,
                last_name: user.last_name,
                role: user.role
            },
            message: 'Login successful!'
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

// Get user profile
app.get('/api/auth/profile', authenticateToken, (req, res) => {
    res.json({
        user: {
            id: req.user.id,
            email: req.user.email,
            first_name: req.user.first_name,
            last_name: req.user.last_name,
            role: req.user.role
        }
    });
});

// Upload file (simulated - stores metadata only)
app.post('/api/files/upload', authenticateToken, (req, res) => {
    try {
        const { fileName, fileData, fileType, fileSize } = req.body;
        
        if (!fileName || !fileData) {
            return res.status(400).json({ error: 'File name and data required' });
        }

        const document = {
            id: nextDocId++,
            user_id: req.user.id,
            filename: `${Date.now()}-${fileName}`,
            original_name: fileName,
            file_type: fileType || 'application/octet-stream',
            file_size: fileSize || fileData.length,
            file_data: fileData, // In real system, this would be stored in cloud storage
            description: req.body.description || '',
            is_public: false,
            upload_date: new Date(),
            created_at: new Date()
        };

        documents.push(document);

        res.json({
            success: true,
            message: 'File uploaded successfully!',
            file: {
                id: document.id,
                filename: document.filename,
                original_name: document.original_name,
                file_type: document.file_type,
                file_size: document.file_size,
                upload_date: document.upload_date
            }
        });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: 'Upload failed' });
    }
});

// Get user's files
app.get('/api/files', authenticateToken, (req, res) => {
    try {
        const userFiles = documents
            .filter(doc => doc.user_id === req.user.id)
            .map(doc => ({
                id: doc.id,
                filename: doc.filename,
                original_name: doc.original_name,
                file_type: doc.file_type,
                file_size: doc.file_size,
                description: doc.description,
                upload_date: doc.upload_date,
                created_at: doc.created_at
            }))
            .sort((a, b) => new Date(b.upload_date) - new Date(a.upload_date));

        res.json({
            success: true,
            files: userFiles,
            total: userFiles.length
        });
    } catch (error) {
        console.error('Get files error:', error);
        res.status(500).json({ error: 'Failed to get files' });
    }
});

// Download file
app.get('/api/files/:id/download', authenticateToken, (req, res) => {
    try {
        const fileId = parseInt(req.params.id);
        const document = documents.find(doc => doc.id === fileId && doc.user_id === req.user.id);
        
        if (!document) {
            return res.status(404).json({ error: 'File not found' });
        }

        // In real system, this would stream from cloud storage
        res.setHeader('Content-Disposition', `attachment; filename="${document.original_name}"`);
        res.setHeader('Content-Type', document.file_type);
        
        // Convert base64 back to buffer if needed
        const fileBuffer = Buffer.from(document.file_data, 'base64');
        res.send(fileBuffer);
    } catch (error) {
        console.error('Download error:', error);
        res.status(500).json({ error: 'Download failed' });
    }
});

// Delete file
app.delete('/api/files/:id', authenticateToken, (req, res) => {
    try {
        const fileId = parseInt(req.params.id);
        const docIndex = documents.findIndex(doc => doc.id === fileId && doc.user_id === req.user.id);
        
        if (docIndex === -1) {
            return res.status(404).json({ error: 'File not found' });
        }

        documents.splice(docIndex, 1);

        res.json({
            success: true,
            message: 'File deleted successfully!'
        });
    } catch (error) {
        console.error('Delete error:', error);
        res.status(500).json({ error: 'Delete failed' });
    }
});

// Get statistics
app.get('/api/stats', authenticateToken, (req, res) => {
    try {
        const userFiles = documents.filter(doc => doc.user_id === req.user.id);
        const totalSize = userFiles.reduce((sum, doc) => sum + (doc.file_size || 0), 0);
        
        res.json({
            total_files: userFiles.length,
            total_size: totalSize,
            recent_uploads: userFiles.slice(0, 5).map(doc => ({
                name: doc.original_name,
                date: doc.upload_date
            }))
        });
    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ error: 'Failed to get statistics' });
    }
});

// Serve frontend for all other routes
app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ error: 'API endpoint not found' });
    }
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({
        error: 'Something went wrong!',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
    });
});

// Initialize and start
async function startServer() {
    try {
        await initializeAdmin();
        console.log('🚀 Math Teacher Document System initialized');
        console.log('📧 Admin Login: admin@teacher.com');
        console.log('🔑 Admin Password: Teacher123!@#');
        
        if (process.env.VERCEL) {
            console.log('🚀 Running on Vercel');
            return app;
        }
        
        app.listen(PORT, () => {
            console.log(`🚀 Server running on port ${PORT}`);
        });
    } catch (error) {
        console.error('❌ Failed to start server:', error);
    }
}

// Export for Vercel
if (process.env.VERCEL) {
    initializeAdmin();
    module.exports = app;
} else {
    startServer();
}