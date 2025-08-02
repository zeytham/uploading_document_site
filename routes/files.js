const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;
const sharp = require('sharp');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const { body, validationResult } = require('express-validator');
const { query, withTransaction } = require('../config/database');
const { authenticateToken, logActivity } = require('../middleware/auth');

const router = express.Router();

// File upload configuration
const storage = multer.diskStorage({
    destination: async (req, file, cb) => {
        const uploadPath = path.join(process.env.UPLOAD_PATH || './uploads', req.user.id.toString());
        try {
            await fs.mkdir(uploadPath, { recursive: true });
            cb(null, uploadPath);
        } catch (error) {
            cb(error);
        }
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        const filename = `${uniqueSuffix}${ext}`;
        cb(null, filename);
    }
});

// File filter
const fileFilter = (req, file, cb) => {
    const allowedTypes = (process.env.ALLOWED_FILE_TYPES || 'pdf,doc,docx,txt,ppt,pptx,xls,xlsx,jpg,jpeg,png,gif').split(',');
    const ext = path.extname(file.originalname).toLowerCase().substring(1);
    
    if (allowedTypes.includes(ext)) {
        cb(null, true);
    } else {
        cb(new Error(`File type .${ext} is not allowed. Allowed types: ${allowedTypes.join(', ')}`), false);
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: parseInt(process.env.MAX_FILE_SIZE) || 50 * 1024 * 1024 // 50MB default
    }
});

// Helper function to get file category based on extension
function getFileCategory(filename) {
    const ext = path.extname(filename).toLowerCase();
    const categories = {
        '.pdf': 'document',
        '.doc': 'document',
        '.docx': 'document',
        '.txt': 'document',
        '.ppt': 'presentation',
        '.pptx': 'presentation',
        '.xls': 'spreadsheet',
        '.xlsx': 'spreadsheet',
        '.jpg': 'image',
        '.jpeg': 'image',
        '.png': 'image',
        '.gif': 'image'
    };
    return categories[ext] || 'other';
}

// Helper function to generate thumbnail for images
async function generateThumbnail(filePath, filename) {
    try {
        const ext = path.extname(filename).toLowerCase();
        if (['.jpg', '.jpeg', '.png'].includes(ext)) {
            const thumbnailPath = path.join(path.dirname(filePath), 'thumb_' + filename);
            await sharp(filePath)
                .resize(200, 200, { fit: 'inside', withoutEnlargement: true })
                .jpeg({ quality: 80 })
                .toFile(thumbnailPath);
            return thumbnailPath;
        }
    } catch (error) {
        console.error('Thumbnail generation error:', error);
    }
    return null;
}

// Upload file(s)
router.post('/upload',
    authenticateToken,
    upload.array('files', 10), // Allow up to 10 files
    [
        body('category').optional().isIn(['document', 'presentation', 'spreadsheet', 'image', 'other']),
        body('description').optional().trim().isLength({ max: 1000 }),
        body('tags').optional().isArray(),
        body('isPublic').optional().isBoolean()
    ],
    logActivity('FILE_UPLOAD', 'document'),
    async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({
                    error: 'Validation failed',
                    details: errors.array()
                });
            }

            if (!req.files || req.files.length === 0) {
                return res.status(400).json({
                    error: 'No files uploaded'
                });
            }

            const { category, description, tags, isPublic } = req.body;
            const uploadedFiles = [];

            for (const file of req.files) {
                try {
                    // Generate thumbnail if it's an image
                    const thumbnailPath = await generateThumbnail(file.path, file.filename);

                    // Insert file record
                    const result = await query(
                        `INSERT INTO documents (user_id, filename, original_name, file_path, file_size, mime_type, category, description, tags, is_public)
                         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                         RETURNING *`,
                        [
                            req.user.id,
                            file.filename,
                            file.originalname,
                            file.path,
                            file.size,
                            file.mimetype,
                            category || getFileCategory(file.originalname),
                            description || null,
                            tags || [],
                            isPublic === 'true' || isPublic === true
                        ]
                    );

                    uploadedFiles.push({
                        id: result.rows[0].id,
                        filename: result.rows[0].filename,
                        originalName: result.rows[0].original_name,
                        size: result.rows[0].file_size,
                        category: result.rows[0].category,
                        uploadedAt: result.rows[0].created_at,
                        hasThumbnail: !!thumbnailPath
                    });

                } catch (fileError) {
                    console.error(`Error processing file ${file.originalname}:`, fileError);
                    // Clean up file if database insert failed
                    try {
                        await fs.unlink(file.path);
                    } catch (unlinkError) {
                        console.error('Failed to clean up file:', unlinkError);
                    }
                }
            }

            if (uploadedFiles.length === 0) {
                return res.status(500).json({
                    error: 'Failed to process any files'
                });
            }

            res.status(201).json({
                message: `Successfully uploaded ${uploadedFiles.length} file(s)`,
                files: uploadedFiles
            });

        } catch (error) {
            console.error('Upload error:', error);
            
            // Clean up uploaded files on error
            if (req.files) {
                for (const file of req.files) {
                    try {
                        await fs.unlink(file.path);
                    } catch (unlinkError) {
                        console.error('Failed to clean up file:', unlinkError);
                    }
                }
            }

            res.status(500).json({
                error: 'Upload failed',
                message: 'An error occurred during file upload'
            });
        }
    }
);

// Get user's files with pagination and filtering
router.get('/',
    authenticateToken,
    async (req, res) => {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = Math.min(parseInt(req.query.limit) || 20, 100);
            const offset = (page - 1) * limit;
            const category = req.query.category;
            const search = req.query.search;
            const sortBy = req.query.sortBy || 'created_at';
            const sortOrder = req.query.sortOrder === 'asc' ? 'ASC' : 'DESC';

            let whereClause = 'WHERE user_id = $1';
            let queryParams = [req.user.id];
            let paramCount = 2;

            if (category) {
                whereClause += ` AND category = $${paramCount}`;
                queryParams.push(category);
                paramCount++;
            }

            if (search) {
                whereClause += ` AND (original_name ILIKE $${paramCount} OR description ILIKE $${paramCount})`;
                queryParams.push(`%${search}%`);
                paramCount++;
            }

            // Get total count
            const countResult = await query(
                `SELECT COUNT(*) FROM documents ${whereClause}`,
                queryParams
            );
            const totalFiles = parseInt(countResult.rows[0].count);

            // Get files
            const validSortColumns = ['created_at', 'original_name', 'file_size', 'download_count'];
            const sortColumn = validSortColumns.includes(sortBy) ? sortBy : 'created_at';

            queryParams.push(limit, offset);
            const filesResult = await query(
                `SELECT id, filename, original_name, file_size, mime_type, category, 
                        description, tags, is_public, download_count, created_at, last_accessed
                 FROM documents ${whereClause}
                 ORDER BY ${sortColumn} ${sortOrder}
                 LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
                queryParams
            );

            res.json({
                files: filesResult.rows.map(file => ({
                    id: file.id,
                    filename: file.filename,
                    originalName: file.original_name,
                    size: file.file_size,
                    mimeType: file.mime_type,
                    category: file.category,
                    description: file.description,
                    tags: file.tags,
                    isPublic: file.is_public,
                    downloadCount: file.download_count,
                    createdAt: file.created_at,
                    lastAccessed: file.last_accessed
                })),
                pagination: {
                    page,
                    limit,
                    total: totalFiles,
                    pages: Math.ceil(totalFiles / limit)
                }
            });

        } catch (error) {
            console.error('Files fetch error:', error);
            res.status(500).json({
                error: 'Failed to fetch files'
            });
        }
    }
);

// Get file details
router.get('/:id',
    authenticateToken,
    async (req, res) => {
        try {
            const fileId = parseInt(req.params.id);
            
            const result = await query(
                `SELECT d.*, u.full_name as owner_name
                 FROM documents d
                 JOIN users u ON d.user_id = u.id
                 WHERE d.id = $1 AND (d.user_id = $2 OR d.is_public = true)`,
                [fileId, req.user.id]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    error: 'File not found'
                });
            }

            const file = result.rows[0];

            res.json({
                id: file.id,
                filename: file.filename,
                originalName: file.original_name,
                size: file.file_size,
                mimeType: file.mime_type,
                category: file.category,
                description: file.description,
                tags: file.tags,
                isPublic: file.is_public,
                downloadCount: file.download_count,
                createdAt: file.created_at,
                updatedAt: file.updated_at,
                lastAccessed: file.last_accessed,
                owner: {
                    name: file.owner_name,
                    isOwner: file.user_id === req.user.id
                }
            });

        } catch (error) {
            console.error('File details fetch error:', error);
            res.status(500).json({
                error: 'Failed to fetch file details'
            });
        }
    }
);

// Download file
router.get('/:id/download',
    authenticateToken,
    logActivity('FILE_DOWNLOAD', 'document'),
    async (req, res) => {
        try {
            const fileId = parseInt(req.params.id);
            
            const result = await query(
                `SELECT * FROM documents 
                 WHERE id = $1 AND (user_id = $2 OR is_public = true)`,
                [fileId, req.user.id]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    error: 'File not found'
                });
            }

            const file = result.rows[0];

            // Check if file exists on disk
            try {
                await fs.access(file.file_path);
            } catch (error) {
                return res.status(404).json({
                    error: 'File not found on disk'
                });
            }

            // Update download count and last accessed
            await query(
                `UPDATE documents 
                 SET download_count = download_count + 1, last_accessed = CURRENT_TIMESTAMP 
                 WHERE id = $1`,
                [fileId]
            );

            // Set appropriate headers
            res.setHeader('Content-Disposition', `attachment; filename="${file.original_name}"`);
            res.setHeader('Content-Type', file.mime_type);
            res.setHeader('Content-Length', file.file_size);

            // Stream the file
            res.sendFile(path.resolve(file.file_path));

        } catch (error) {
            console.error('File download error:', error);
            res.status(500).json({
                error: 'Failed to download file'
            });
        }
    }
);

// Preview file (for images and text files)
router.get('/:id/preview',
    authenticateToken,
    async (req, res) => {
        try {
            const fileId = parseInt(req.params.id);
            
            const result = await query(
                `SELECT * FROM documents 
                 WHERE id = $1 AND (user_id = $2 OR is_public = true)`,
                [fileId, req.user.id]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    error: 'File not found'
                });
            }

            const file = result.rows[0];
            const ext = path.extname(file.original_name).toLowerCase();

            // Check if thumbnail exists for images
            if (['.jpg', '.jpeg', '.png', '.gif'].includes(ext)) {
                const thumbnailPath = path.join(path.dirname(file.file_path), 'thumb_' + file.filename);
                try {
                    await fs.access(thumbnailPath);
                    return res.sendFile(path.resolve(thumbnailPath));
                } catch (error) {
                    // Fall back to original image
                    return res.sendFile(path.resolve(file.file_path));
                }
            }

            // For text files, return content
            if (ext === '.txt') {
                try {
                    const content = await fs.readFile(file.file_path, 'utf8');
                    return res.json({
                        type: 'text',
                        content: content.substring(0, 5000) // Limit to first 5000 characters
                    });
                } catch (error) {
                    return res.status(500).json({
                        error: 'Failed to read text file'
                    });
                }
            }

            // For PDFs, extract text preview
            if (ext === '.pdf') {
                try {
                    const dataBuffer = await fs.readFile(file.file_path);
                    const data = await pdfParse(dataBuffer);
                    return res.json({
                        type: 'pdf',
                        content: data.text.substring(0, 5000),
                        pages: data.numpages
                    });
                } catch (error) {
                    return res.status(500).json({
                        error: 'Failed to extract PDF content'
                    });
                }
            }

            // For Word documents
            if (['.doc', '.docx'].includes(ext)) {
                try {
                    const result = await mammoth.extractRawText({ path: file.file_path });
                    return res.json({
                        type: 'document',
                        content: result.value.substring(0, 5000)
                    });
                } catch (error) {
                    return res.status(500).json({
                        error: 'Failed to extract document content'
                    });
                }
            }

            res.json({
                type: 'unsupported',
                message: 'Preview not available for this file type'
            });

        } catch (error) {
            console.error('File preview error:', error);
            res.status(500).json({
                error: 'Failed to generate preview'
            });
        }
    }
);

// Update file metadata
router.put('/:id',
    authenticateToken,
    [
        body('description').optional().trim().isLength({ max: 1000 }),
        body('tags').optional().isArray(),
        body('isPublic').optional().isBoolean(),
        body('category').optional().isIn(['document', 'presentation', 'spreadsheet', 'image', 'other'])
    ],
    logActivity('FILE_UPDATE', 'document'),
    async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({
                    error: 'Validation failed',
                    details: errors.array()
                });
            }

            const fileId = parseInt(req.params.id);
            const { description, tags, isPublic, category } = req.body;

            // Check if user owns the file
            const checkResult = await query(
                'SELECT id FROM documents WHERE id = $1 AND user_id = $2',
                [fileId, req.user.id]
            );

            if (checkResult.rows.length === 0) {
                return res.status(404).json({
                    error: 'File not found or access denied'
                });
            }

            const updates = [];
            const values = [];
            let paramCount = 1;

            if (description !== undefined) {
                updates.push(`description = $${paramCount++}`);
                values.push(description);
            }
            if (tags !== undefined) {
                updates.push(`tags = $${paramCount++}`);
                values.push(tags);
            }
            if (isPublic !== undefined) {
                updates.push(`is_public = $${paramCount++}`);
                values.push(isPublic);
            }
            if (category !== undefined) {
                updates.push(`category = $${paramCount++}`);
                values.push(category);
            }

            if (updates.length === 0) {
                return res.status(400).json({
                    error: 'No valid fields to update'
                });
            }

            values.push(fileId);

            const result = await query(
                `UPDATE documents SET ${updates.join(', ')} 
                 WHERE id = $${paramCount} 
                 RETURNING id, original_name, description, tags, is_public, category, updated_at`,
                values
            );

            res.json({
                message: 'File updated successfully',
                file: result.rows[0]
            });

        } catch (error) {
            console.error('File update error:', error);
            res.status(500).json({
                error: 'Failed to update file'
            });
        }
    }
);

// Delete file
router.delete('/:id',
    authenticateToken,
    logActivity('FILE_DELETE', 'document'),
    async (req, res) => {
        try {
            const fileId = parseInt(req.params.id);

            // Get file details and check ownership
            const result = await query(
                'SELECT * FROM documents WHERE id = $1 AND user_id = $2',
                [fileId, req.user.id]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    error: 'File not found or access denied'
                });
            }

            const file = result.rows[0];

            // Delete from database first
            await query('DELETE FROM documents WHERE id = $1', [fileId]);

            // Delete physical file
            try {
                await fs.unlink(file.file_path);
                
                // Delete thumbnail if exists
                const thumbnailPath = path.join(path.dirname(file.file_path), 'thumb_' + file.filename);
                try {
                    await fs.unlink(thumbnailPath);
                } catch (thumbError) {
                    // Thumbnail might not exist, ignore error
                }
            } catch (fsError) {
                console.error('Failed to delete physical file:', fsError);
                // File might have been already deleted, continue
            }

            res.json({
                message: 'File deleted successfully',
                filename: file.original_name
            });

        } catch (error) {
            console.error('File deletion error:', error);
            res.status(500).json({
                error: 'Failed to delete file'
            });
        }
    }
);

// Get storage statistics
router.get('/stats/storage',
    authenticateToken,
    async (req, res) => {
        try {
            const result = await query(
                `SELECT 
                    COUNT(*) as total_files,
                    SUM(file_size) as total_size,
                    AVG(file_size) as average_size,
                    COUNT(CASE WHEN category = 'document' THEN 1 END) as documents,
                    COUNT(CASE WHEN category = 'image' THEN 1 END) as images,
                    COUNT(CASE WHEN category = 'presentation' THEN 1 END) as presentations,
                    COUNT(CASE WHEN category = 'spreadsheet' THEN 1 END) as spreadsheets,
                    COUNT(CASE WHEN category = 'other' THEN 1 END) as others
                 FROM documents 
                 WHERE user_id = $1`,
                [req.user.id]
            );

            const stats = result.rows[0];

            res.json({
                totalFiles: parseInt(stats.total_files),
                totalSize: parseInt(stats.total_size) || 0,
                averageSize: parseInt(stats.average_size) || 0,
                categories: {
                    documents: parseInt(stats.documents),
                    images: parseInt(stats.images),
                    presentations: parseInt(stats.presentations),
                    spreadsheets: parseInt(stats.spreadsheets),
                    others: parseInt(stats.others)
                }
            });

        } catch (error) {
            console.error('Storage stats error:', error);
            res.status(500).json({
                error: 'Failed to fetch storage statistics'
            });
        }
    }
);

module.exports = router;