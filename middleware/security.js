const rateLimit = require('express-rate-limit');
const { query } = require('../config/database');
const crypto = require('crypto');

// Brute force protection for login attempts
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // Limit each IP to 5 requests per windowMs
    message: {
        error: 'Too many login attempts',
        message: 'Please try again after 15 minutes'
    },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
        // Skip rate limiting for successful logins
        return req.loginSuccess === true;
    }
});

// General API rate limiting
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: {
        error: 'Too many requests',
        message: 'Please try again later'
    },
    standardHeaders: true,
    legacyHeaders: false
});

// File upload rate limiting
const uploadLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 50, // Limit each IP to 50 uploads per hour
    message: {
        error: 'Upload limit exceeded',
        message: 'Please wait before uploading more files'
    }
});

// Account lockout middleware
const checkAccountLockout = async (req, res, next) => {
    try {
        const { email } = req.body;
        
        if (!email) {
            return next();
        }

        const result = await query(
            `SELECT failed_login_attempts, locked_until 
             FROM users 
             WHERE email = $1`,
            [email]
        );

        if (result.rows.length > 0) {
            const user = result.rows[0];
            
            // Check if account is currently locked
            if (user.locked_until && new Date() < new Date(user.locked_until)) {
                const remainingTime = Math.ceil((new Date(user.locked_until) - new Date()) / 1000 / 60);
                
                // Log security event
                await logSecurityEvent('ACCOUNT_LOCKED_ACCESS_ATTEMPT', null, req, {
                    email,
                    remainingLockTime: remainingTime
                }, 'medium');
                
                return res.status(423).json({
                    error: 'Account locked',
                    message: `Account is locked. Try again in ${remainingTime} minutes.`,
                    lockedUntil: user.locked_until
                });
            }
        }

        next();
    } catch (error) {
        console.error('Account lockout check error:', error);
        next();
    }
};

// Password strength validation
const validatePasswordStrength = (req, res, next) => {
    const { password } = req.body;
    
    if (!password) {
        return next();
    }

    const minLength = 8;
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumbers = /\d/.test(password);
    const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);

    const errors = [];

    if (password.length < minLength) {
        errors.push(`Password must be at least ${minLength} characters long`);
    }
    if (!hasUpperCase) {
        errors.push('Password must contain at least one uppercase letter');
    }
    if (!hasLowerCase) {
        errors.push('Password must contain at least one lowercase letter');
    }
    if (!hasNumbers) {
        errors.push('Password must contain at least one number');
    }
    if (!hasSpecialChar) {
        errors.push('Password must contain at least one special character');
    }

    // Check for common passwords
    const commonPasswords = [
        'password', '123456', '123456789', 'qwerty', 'abc123',
        'password123', 'admin', 'letmein', 'welcome', 'monkey'
    ];
    
    if (commonPasswords.includes(password.toLowerCase())) {
        errors.push('Password is too common. Please choose a more secure password');
    }

    if (errors.length > 0) {
        return res.status(400).json({
            error: 'Password validation failed',
            details: errors
        });
    }

    next();
};

// Input sanitization middleware
const sanitizeInput = (req, res, next) => {
    const sanitizeString = (str) => {
        if (typeof str !== 'string') return str;
        
        // Remove potential XSS attacks
        return str
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            .replace(/<[^>]*>?/gm, '')
            .replace(/javascript:/gi, '')
            .replace(/on\w+\s*=/gi, '')
            .trim();
    };

    const sanitizeObject = (obj) => {
        if (obj === null || typeof obj !== 'object') return obj;
        
        if (Array.isArray(obj)) {
            return obj.map(sanitizeObject);
        }
        
        const sanitized = {};
        for (const [key, value] of Object.entries(obj)) {
            if (typeof value === 'string') {
                sanitized[key] = sanitizeString(value);
            } else if (typeof value === 'object') {
                sanitized[key] = sanitizeObject(value);
            } else {
                sanitized[key] = value;
            }
        }
        return sanitized;
    };

    req.body = sanitizeObject(req.body);
    req.query = sanitizeObject(req.query);
    req.params = sanitizeObject(req.params);

    next();
};

// IP whitelist/blacklist middleware
const ipFilter = async (req, res, next) => {
    const clientIP = req.ip || req.connection.remoteAddress;
    
    try {
        // Check for suspicious activity from this IP
        const suspiciousActivity = await query(
            `SELECT COUNT(*) as count
             FROM security_events 
             WHERE ip_address = $1 
             AND severity IN ('high', 'critical')
             AND created_at > NOW() - INTERVAL '24 hours'
             AND resolved = false`,
            [clientIP]
        );

        if (parseInt(suspiciousActivity.rows[0].count) > 10) {
            await logSecurityEvent('IP_BLOCKED_SUSPICIOUS_ACTIVITY', null, req, {
                suspiciousEventCount: suspiciousActivity.rows[0].count
            }, 'high');
            
            return res.status(403).json({
                error: 'Access denied',
                message: 'Your IP has been temporarily blocked due to suspicious activity'
            });
        }

        next();
    } catch (error) {
        console.error('IP filter error:', error);
        next();
    }
};

// File type validation
const validateFileType = (allowedTypes = []) => {
    return (req, res, next) => {
        if (!req.files || req.files.length === 0) {
            return next();
        }

        const defaultAllowedTypes = [
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'text/plain',
            'application/vnd.ms-powerpoint',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'image/jpeg',
            'image/png',
            'image/gif'
        ];

        const allowed = allowedTypes.length > 0 ? allowedTypes : defaultAllowedTypes;
        
        for (const file of req.files) {
            if (!allowed.includes(file.mimetype)) {
                return res.status(400).json({
                    error: 'Invalid file type',
                    message: `File type ${file.mimetype} is not allowed`,
                    allowedTypes: allowed
                });
            }

            // Check file size (50MB limit)
            const maxSize = 50 * 1024 * 1024;
            if (file.size > maxSize) {
                return res.status(400).json({
                    error: 'File too large',
                    message: `File size must not exceed ${maxSize / 1024 / 1024}MB`
                });
            }
        }

        next();
    };
};

// CSRF protection middleware
const csrfProtection = (req, res, next) => {
    // Skip CSRF for GET requests and API endpoints
    if (req.method === 'GET' || req.path.startsWith('/api/')) {
        return next();
    }

    const token = req.headers['x-csrf-token'] || req.body._csrf;
    const sessionToken = req.session?.csrfToken;

    if (!token || !sessionToken || token !== sessionToken) {
        return res.status(403).json({
            error: 'CSRF token validation failed',
            message: 'Invalid or missing CSRF token'
        });
    }

    next();
};

// Security headers middleware
const securityHeaders = (req, res, next) => {
    // Prevent clickjacking
    res.setHeader('X-Frame-Options', 'DENY');
    
    // Prevent MIME type sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff');
    
    // Enable XSS protection
    res.setHeader('X-XSS-Protection', '1; mode=block');
    
    // Referrer policy
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    
    // Permissions policy
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    
    next();
};

// Log security events
async function logSecurityEvent(eventType, userId, req, details = {}, severity = 'low') {
    try {
        await query(
            `INSERT INTO security_events (event_type, user_id, ip_address, user_agent, details, severity)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
                eventType,
                userId,
                req.ip || req.connection.remoteAddress,
                req.get('User-Agent'),
                JSON.stringify(details),
                severity
            ]
        );
    } catch (error) {
        console.error('Failed to log security event:', error);
    }
}

// Handle failed login attempts
async function handleFailedLogin(email, req) {
    try {
        const result = await query(
            `UPDATE users 
             SET failed_login_attempts = failed_login_attempts + 1,
                 locked_until = CASE 
                     WHEN failed_login_attempts + 1 >= 5 THEN NOW() + INTERVAL '30 minutes'
                     ELSE locked_until
                 END
             WHERE email = $1
             RETURNING failed_login_attempts, locked_until`,
            [email]
        );

        if (result.rows.length > 0) {
            const user = result.rows[0];
            
            await logSecurityEvent('FAILED_LOGIN_ATTEMPT', null, req, {
                email,
                attempts: user.failed_login_attempts,
                locked: !!user.locked_until
            }, user.failed_login_attempts >= 3 ? 'medium' : 'low');

            if (user.failed_login_attempts >= 5) {
                await logSecurityEvent('ACCOUNT_LOCKED', null, req, {
                    email,
                    lockedUntil: user.locked_until
                }, 'high');
            }
        }
    } catch (error) {
        console.error('Failed to handle failed login:', error);
    }
}

// Reset failed login attempts on successful login
async function resetFailedAttempts(userId) {
    try {
        await query(
            `UPDATE users 
             SET failed_login_attempts = 0, locked_until = NULL
             WHERE id = $1`,
            [userId]
        );
    } catch (error) {
        console.error('Failed to reset login attempts:', error);
    }
}

// Generate secure session token
function generateSecureToken() {
    return crypto.randomBytes(32).toString('hex');
}

// Validate session token
async function validateSession(token) {
    try {
        const result = await query(
            `SELECT us.*, u.id as user_id, u.email, u.full_name, u.role, u.is_active
             FROM user_sessions us
             JOIN users u ON us.user_id = u.id
             WHERE us.session_token = $1 
             AND us.is_active = true 
             AND us.expires_at > NOW()`,
            [token]
        );

        if (result.rows.length > 0) {
            // Update last activity
            await query(
                'UPDATE user_sessions SET last_activity = NOW() WHERE session_token = $1',
                [token]
            );
            
            return result.rows[0];
        }

        return null;
    } catch (error) {
        console.error('Session validation error:', error);
        return null;
    }
}

module.exports = {
    loginLimiter,
    apiLimiter,
    uploadLimiter,
    checkAccountLockout,
    validatePasswordStrength,
    sanitizeInput,
    ipFilter,
    validateFileType,
    csrfProtection,
    securityHeaders,
    logSecurityEvent,
    handleFailedLogin,
    resetFailedAttempts,
    generateSecureToken,
    validateSession
};