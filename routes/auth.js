const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { query, withTransaction } = require('../config/database');
const { authenticateToken, logActivity } = require('../middleware/auth');

const router = express.Router();

// Validation rules
const registerValidation = [
    body('email').isEmail().normalizeEmail().withMessage('Please provide a valid email'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters long'),
    body('fullName').trim().isLength({ min: 2 }).withMessage('Full name must be at least 2 characters'),
    body('subject').optional().trim().isLength({ max: 100 }),
    body('school').optional().trim().isLength({ max: 255 })
];

const loginValidation = [
    body('email').isEmail().normalizeEmail().withMessage('Please provide a valid email'),
    body('password').notEmpty().withMessage('Password is required')
];

// Register new user
router.post('/register', registerValidation, async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation failed',
                details: errors.array()
            });
        }

        const { email, password, fullName, subject, school } = req.body;

        // Check if user already exists
        const existingUser = await query('SELECT id FROM users WHERE email = $1', [email]);
        if (existingUser.rows.length > 0) {
            return res.status(409).json({
                error: 'User already exists',
                message: 'An account with this email already exists'
            });
        }

        // Hash password
        const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
        const passwordHash = await bcrypt.hash(password, saltRounds);

        // Create user
        const result = await query(
            `INSERT INTO users (email, password_hash, full_name, subject, school) 
             VALUES ($1, $2, $3, $4, $5) 
             RETURNING id, email, full_name, role, created_at`,
            [email, passwordHash, fullName, subject || null, school || null]
        );

        const user = result.rows[0];

        // Generate JWT token
        const token = jwt.sign(
            { userId: user.id, email: user.email },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
        );

        // Log registration
        await query(
            `INSERT INTO audit_logs (user_id, action, resource_type, details, ip_address, user_agent)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
                user.id,
                'USER_REGISTERED',
                'user',
                JSON.stringify({ email: user.email }),
                req.ip,
                req.get('User-Agent')
            ]
        );

        res.status(201).json({
            message: 'User registered successfully',
            user: {
                id: user.id,
                email: user.email,
                fullName: user.full_name,
                role: user.role
            },
            token
        });

    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({
            error: 'Registration failed',
            message: 'An error occurred during registration'
        });
    }
});

// Login user
router.post('/login', loginValidation, async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                error: 'Validation failed',
                details: errors.array()
            });
        }

        const { email, password } = req.body;

        // Get user from database
        const result = await query(
            'SELECT id, email, password_hash, full_name, role, is_active FROM users WHERE email = $1',
            [email]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({
                error: 'Invalid credentials',
                message: 'Email or password is incorrect'
            });
        }

        const user = result.rows[0];

        if (!user.is_active) {
            return res.status(401).json({
                error: 'Account deactivated',
                message: 'Your account has been deactivated'
            });
        }

        // Verify password
        const isValidPassword = await bcrypt.compare(password, user.password_hash);
        if (!isValidPassword) {
            return res.status(401).json({
                error: 'Invalid credentials',
                message: 'Email or password is incorrect'
            });
        }

        // Update last login
        await query('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1', [user.id]);

        // Generate JWT token
        const token = jwt.sign(
            { userId: user.id, email: user.email },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
        );

        // Log login
        await query(
            `INSERT INTO audit_logs (user_id, action, resource_type, details, ip_address, user_agent)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
                user.id,
                'USER_LOGIN',
                'user',
                JSON.stringify({ email: user.email }),
                req.ip,
                req.get('User-Agent')
            ]
        );

        res.json({
            message: 'Login successful',
            user: {
                id: user.id,
                email: user.email,
                fullName: user.full_name,
                role: user.role
            },
            token
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            error: 'Login failed',
            message: 'An error occurred during login'
        });
    }
});

// Get current user profile
router.get('/profile', authenticateToken, async (req, res) => {
    try {
        const result = await query(
            `SELECT id, email, full_name, role, subject, school, profile_picture, 
                    created_at, last_login
             FROM users WHERE id = $1`,
            [req.user.id]
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
                MAX(created_at) as last_upload
             FROM documents WHERE user_id = $1`,
            [req.user.id]
        );

        const stats = statsResult.rows[0];

        res.json({
            user: {
                id: user.id,
                email: user.email,
                fullName: user.full_name,
                role: user.role,
                subject: user.subject,
                school: user.school,
                profilePicture: user.profile_picture,
                createdAt: user.created_at,
                lastLogin: user.last_login
            },
            statistics: {
                totalDocuments: parseInt(stats.total_documents),
                totalStorageUsed: parseInt(stats.total_storage_used) || 0,
                lastUpload: stats.last_upload
            }
        });

    } catch (error) {
        console.error('Profile fetch error:', error);
        res.status(500).json({
            error: 'Failed to fetch profile'
        });
    }
});

// Update user profile
router.put('/profile', 
    authenticateToken,
    [
        body('fullName').optional().trim().isLength({ min: 2 }),
        body('subject').optional().trim().isLength({ max: 100 }),
        body('school').optional().trim().isLength({ max: 255 })
    ],
    logActivity('PROFILE_UPDATE', 'user'),
    async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({
                    error: 'Validation failed',
                    details: errors.array()
                });
            }

            const { fullName, subject, school } = req.body;
            const updates = [];
            const values = [];
            let paramCount = 1;

            if (fullName !== undefined) {
                updates.push(`full_name = $${paramCount++}`);
                values.push(fullName);
            }
            if (subject !== undefined) {
                updates.push(`subject = $${paramCount++}`);
                values.push(subject);
            }
            if (school !== undefined) {
                updates.push(`school = $${paramCount++}`);
                values.push(school);
            }

            if (updates.length === 0) {
                return res.status(400).json({
                    error: 'No valid fields to update'
                });
            }

            values.push(req.user.id);

            const result = await query(
                `UPDATE users SET ${updates.join(', ')} 
                 WHERE id = $${paramCount} 
                 RETURNING id, email, full_name, subject, school`,
                values
            );

            res.json({
                message: 'Profile updated successfully',
                user: result.rows[0]
            });

        } catch (error) {
            console.error('Profile update error:', error);
            res.status(500).json({
                error: 'Failed to update profile'
            });
        }
    }
);

// Change password
router.put('/change-password',
    authenticateToken,
    [
        body('currentPassword').notEmpty().withMessage('Current password is required'),
        body('newPassword').isLength({ min: 8 }).withMessage('New password must be at least 8 characters long')
    ],
    logActivity('PASSWORD_CHANGE', 'user'),
    async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({
                    error: 'Validation failed',
                    details: errors.array()
                });
            }

            const { currentPassword, newPassword } = req.body;

            // Get current password hash
            const result = await query(
                'SELECT password_hash FROM users WHERE id = $1',
                [req.user.id]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    error: 'User not found'
                });
            }

            // Verify current password
            const isValidPassword = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
            if (!isValidPassword) {
                return res.status(401).json({
                    error: 'Invalid current password'
                });
            }

            // Hash new password
            const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
            const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);

            // Update password
            await query(
                'UPDATE users SET password_hash = $1 WHERE id = $2',
                [newPasswordHash, req.user.id]
            );

            res.json({
                message: 'Password changed successfully'
            });

        } catch (error) {
            console.error('Password change error:', error);
            res.status(500).json({
                error: 'Failed to change password'
            });
        }
    }
);

// Logout (invalidate token on client side)
router.post('/logout', 
    authenticateToken, 
    logActivity('USER_LOGOUT', 'user'),
    (req, res) => {
        res.json({
            message: 'Logged out successfully'
        });
    }
);

// Verify token
router.get('/verify', authenticateToken, (req, res) => {
    res.json({
        valid: true,
        user: {
            id: req.user.id,
            email: req.user.email,
            fullName: req.user.full_name,
            role: req.user.role
        }
    });
});

module.exports = router;