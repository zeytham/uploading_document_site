const express = require('express');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/database');
const { authenticateToken, requireAdmin, logActivity } = require('../middleware/auth');

const router = express.Router();

// Get all users (admin only)
router.get('/',
    authenticateToken,
    requireAdmin,
    async (req, res) => {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = Math.min(parseInt(req.query.limit) || 20, 100);
            const offset = (page - 1) * limit;
            const search = req.query.search;
            const role = req.query.role;
            const isActive = req.query.isActive;

            let whereClause = 'WHERE 1=1';
            let queryParams = [];
            let paramCount = 1;

            if (search) {
                whereClause += ` AND (full_name ILIKE $${paramCount} OR email ILIKE $${paramCount})`;
                queryParams.push(`%${search}%`);
                paramCount++;
            }

            if (role) {
                whereClause += ` AND role = $${paramCount}`;
                queryParams.push(role);
                paramCount++;
            }

            if (isActive !== undefined) {
                whereClause += ` AND is_active = $${paramCount}`;
                queryParams.push(isActive === 'true');
                paramCount++;
            }

            // Get total count
            const countResult = await query(
                `SELECT COUNT(*) FROM users ${whereClause}`,
                queryParams
            );
            const totalUsers = parseInt(countResult.rows[0].count);

            // Get users
            queryParams.push(limit, offset);
            const usersResult = await query(
                `SELECT id, email, full_name, role, subject, school, is_active, 
                        created_at, last_login,
                        (SELECT COUNT(*) FROM documents WHERE user_id = users.id) as document_count,
                        (SELECT SUM(file_size) FROM documents WHERE user_id = users.id) as storage_used
                 FROM users ${whereClause}
                 ORDER BY created_at DESC
                 LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
                queryParams
            );

            res.json({
                users: usersResult.rows.map(user => ({
                    id: user.id,
                    email: user.email,
                    fullName: user.full_name,
                    role: user.role,
                    subject: user.subject,
                    school: user.school,
                    isActive: user.is_active,
                    createdAt: user.created_at,
                    lastLogin: user.last_login,
                    statistics: {
                        documentCount: parseInt(user.document_count),
                        storageUsed: parseInt(user.storage_used) || 0
                    }
                })),
                pagination: {
                    page,
                    limit,
                    total: totalUsers,
                    pages: Math.ceil(totalUsers / limit)
                }
            });

        } catch (error) {
            console.error('Users fetch error:', error);
            res.status(500).json({
                error: 'Failed to fetch users'
            });
        }
    }
);

// Get user details (admin only)
router.get('/:id',
    authenticateToken,
    requireAdmin,
    async (req, res) => {
        try {
            const userId = parseInt(req.params.id);

            const result = await query(
                `SELECT id, email, full_name, role, subject, school, profile_picture,
                        is_active, created_at, updated_at, last_login
                 FROM users WHERE id = $1`,
                [userId]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    error: 'User not found'
                });
            }

            const user = result.rows[0];

            // Get user statistics
            const statsResult = await query(
                `SELECT 
                    COUNT(*) as total_documents,
                    SUM(file_size) as total_storage_used,
                    COUNT(CASE WHEN created_at > CURRENT_DATE - INTERVAL '30 days' THEN 1 END) as recent_uploads,
                    MAX(created_at) as last_upload
                 FROM documents WHERE user_id = $1`,
                [userId]
            );

            const stats = statsResult.rows[0];

            // Get recent activity
            const activityResult = await query(
                `SELECT action, resource_type, created_at, details
                 FROM audit_logs 
                 WHERE user_id = $1 
                 ORDER BY created_at DESC 
                 LIMIT 10`,
                [userId]
            );

            res.json({
                user: {
                    id: user.id,
                    email: user.email,
                    fullName: user.full_name,
                    role: user.role,
                    subject: user.subject,
                    school: user.school,
                    profilePicture: user.profile_picture,
                    isActive: user.is_active,
                    createdAt: user.created_at,
                    updatedAt: user.updated_at,
                    lastLogin: user.last_login
                },
                statistics: {
                    totalDocuments: parseInt(stats.total_documents),
                    totalStorageUsed: parseInt(stats.total_storage_used) || 0,
                    recentUploads: parseInt(stats.recent_uploads),
                    lastUpload: stats.last_upload
                },
                recentActivity: activityResult.rows
            });

        } catch (error) {
            console.error('User details fetch error:', error);
            res.status(500).json({
                error: 'Failed to fetch user details'
            });
        }
    }
);

// Update user (admin only)
router.put('/:id',
    authenticateToken,
    requireAdmin,
    [
        body('fullName').optional().trim().isLength({ min: 2 }),
        body('role').optional().isIn(['teacher', 'admin']),
        body('subject').optional().trim().isLength({ max: 100 }),
        body('school').optional().trim().isLength({ max: 255 }),
        body('isActive').optional().isBoolean()
    ],
    logActivity('USER_UPDATE', 'user'),
    async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({
                    error: 'Validation failed',
                    details: errors.array()
                });
            }

            const userId = parseInt(req.params.id);
            const { fullName, role, subject, school, isActive } = req.body;

            // Check if user exists
            const checkResult = await query('SELECT id FROM users WHERE id = $1', [userId]);
            if (checkResult.rows.length === 0) {
                return res.status(404).json({
                    error: 'User not found'
                });
            }

            const updates = [];
            const values = [];
            let paramCount = 1;

            if (fullName !== undefined) {
                updates.push(`full_name = $${paramCount++}`);
                values.push(fullName);
            }
            if (role !== undefined) {
                updates.push(`role = $${paramCount++}`);
                values.push(role);
            }
            if (subject !== undefined) {
                updates.push(`subject = $${paramCount++}`);
                values.push(subject);
            }
            if (school !== undefined) {
                updates.push(`school = $${paramCount++}`);
                values.push(school);
            }
            if (isActive !== undefined) {
                updates.push(`is_active = $${paramCount++}`);
                values.push(isActive);
            }

            if (updates.length === 0) {
                return res.status(400).json({
                    error: 'No valid fields to update'
                });
            }

            values.push(userId);

            const result = await query(
                `UPDATE users SET ${updates.join(', ')} 
                 WHERE id = $${paramCount} 
                 RETURNING id, email, full_name, role, subject, school, is_active, updated_at`,
                values
            );

            res.json({
                message: 'User updated successfully',
                user: result.rows[0]
            });

        } catch (error) {
            console.error('User update error:', error);
            res.status(500).json({
                error: 'Failed to update user'
            });
        }
    }
);

// Delete user (admin only)
router.delete('/:id',
    authenticateToken,
    requireAdmin,
    logActivity('USER_DELETE', 'user'),
    async (req, res) => {
        try {
            const userId = parseInt(req.params.id);

            // Prevent admin from deleting themselves
            if (userId === req.user.id) {
                return res.status(400).json({
                    error: 'Cannot delete your own account'
                });
            }

            // Check if user exists
            const userResult = await query(
                'SELECT email, full_name FROM users WHERE id = $1',
                [userId]
            );

            if (userResult.rows.length === 0) {
                return res.status(404).json({
                    error: 'User not found'
                });
            }

            const user = userResult.rows[0];

            // Delete user (CASCADE will handle related records)
            await query('DELETE FROM users WHERE id = $1', [userId]);

            res.json({
                message: 'User deleted successfully',
                deletedUser: {
                    email: user.email,
                    fullName: user.full_name
                }
            });

        } catch (error) {
            console.error('User deletion error:', error);
            res.status(500).json({
                error: 'Failed to delete user'
            });
        }
    }
);

// Get system statistics (admin only)
router.get('/stats/system',
    authenticateToken,
    requireAdmin,
    async (req, res) => {
        try {
            // Get user statistics
            const userStatsResult = await query(`
                SELECT 
                    COUNT(*) as total_users,
                    COUNT(CASE WHEN is_active = true THEN 1 END) as active_users,
                    COUNT(CASE WHEN role = 'admin' THEN 1 END) as admin_users,
                    COUNT(CASE WHEN created_at > CURRENT_DATE - INTERVAL '30 days' THEN 1 END) as new_users_30_days,
                    COUNT(CASE WHEN last_login > CURRENT_DATE - INTERVAL '7 days' THEN 1 END) as active_users_7_days
                FROM users
            `);

            // Get document statistics
            const docStatsResult = await query(`
                SELECT 
                    COUNT(*) as total_documents,
                    SUM(file_size) as total_storage_used,
                    AVG(file_size) as average_file_size,
                    COUNT(CASE WHEN created_at > CURRENT_DATE - INTERVAL '30 days' THEN 1 END) as new_documents_30_days,
                    COUNT(CASE WHEN is_public = true THEN 1 END) as public_documents
                FROM documents
            `);

            // Get category breakdown
            const categoryStatsResult = await query(`
                SELECT 
                    category,
                    COUNT(*) as count,
                    SUM(file_size) as total_size
                FROM documents 
                GROUP BY category
                ORDER BY count DESC
            `);

            // Get recent activity
            const activityResult = await query(`
                SELECT 
                    DATE(created_at) as date,
                    COUNT(*) as activity_count
                FROM audit_logs 
                WHERE created_at > CURRENT_DATE - INTERVAL '30 days'
                GROUP BY DATE(created_at)
                ORDER BY date DESC
                LIMIT 30
            `);

            const userStats = userStatsResult.rows[0];
            const docStats = docStatsResult.rows[0];

            res.json({
                users: {
                    total: parseInt(userStats.total_users),
                    active: parseInt(userStats.active_users),
                    admins: parseInt(userStats.admin_users),
                    newLast30Days: parseInt(userStats.new_users_30_days),
                    activeLast7Days: parseInt(userStats.active_users_7_days)
                },
                documents: {
                    total: parseInt(docStats.total_documents),
                    totalStorageUsed: parseInt(docStats.total_storage_used) || 0,
                    averageFileSize: parseInt(docStats.average_file_size) || 0,
                    newLast30Days: parseInt(docStats.new_documents_30_days),
                    publicDocuments: parseInt(docStats.public_documents)
                },
                categories: categoryStatsResult.rows.map(cat => ({
                    category: cat.category,
                    count: parseInt(cat.count),
                    totalSize: parseInt(cat.total_size) || 0
                })),
                dailyActivity: activityResult.rows.map(activity => ({
                    date: activity.date,
                    count: parseInt(activity.activity_count)
                }))
            });

        } catch (error) {
            console.error('System stats error:', error);
            res.status(500).json({
                error: 'Failed to fetch system statistics'
            });
        }
    }
);

// Get audit logs (admin only)
router.get('/logs/audit',
    authenticateToken,
    requireAdmin,
    async (req, res) => {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = Math.min(parseInt(req.query.limit) || 50, 200);
            const offset = (page - 1) * limit;
            const userId = req.query.userId;
            const action = req.query.action;
            const resourceType = req.query.resourceType;

            let whereClause = 'WHERE 1=1';
            let queryParams = [];
            let paramCount = 1;

            if (userId) {
                whereClause += ` AND user_id = $${paramCount}`;
                queryParams.push(parseInt(userId));
                paramCount++;
            }

            if (action) {
                whereClause += ` AND action = $${paramCount}`;
                queryParams.push(action);
                paramCount++;
            }

            if (resourceType) {
                whereClause += ` AND resource_type = $${paramCount}`;
                queryParams.push(resourceType);
                paramCount++;
            }

            // Get total count
            const countResult = await query(
                `SELECT COUNT(*) FROM audit_logs ${whereClause}`,
                queryParams
            );
            const totalLogs = parseInt(countResult.rows[0].count);

            // Get logs
            queryParams.push(limit, offset);
            const logsResult = await query(
                `SELECT al.*, u.full_name, u.email
                 FROM audit_logs al
                 LEFT JOIN users u ON al.user_id = u.id
                 ${whereClause}
                 ORDER BY al.created_at DESC
                 LIMIT $${paramCount} OFFSET $${paramCount + 1}`,
                queryParams
            );

            res.json({
                logs: logsResult.rows.map(log => ({
                    id: log.id,
                    action: log.action,
                    resourceType: log.resource_type,
                    resourceId: log.resource_id,
                    details: log.details,
                    ipAddress: log.ip_address,
                    userAgent: log.user_agent,
                    createdAt: log.created_at,
                    user: log.user_id ? {
                        id: log.user_id,
                        fullName: log.full_name,
                        email: log.email
                    } : null
                })),
                pagination: {
                    page,
                    limit,
                    total: totalLogs,
                    pages: Math.ceil(totalLogs / limit)
                }
            });

        } catch (error) {
            console.error('Audit logs fetch error:', error);
            res.status(500).json({
                error: 'Failed to fetch audit logs'
            });
        }
    }
);

module.exports = router;