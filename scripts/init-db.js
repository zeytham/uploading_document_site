const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'teacher_documents',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'password',
});

async function initializeDatabase() {
    const client = await pool.connect();
    
    try {
        console.log('🔄 Initializing database...');
        
        // Create users table
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                email VARCHAR(255) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                full_name VARCHAR(255) NOT NULL,
                role VARCHAR(50) DEFAULT 'teacher',
                is_active BOOLEAN DEFAULT true,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_login TIMESTAMP,
                profile_picture VARCHAR(255),
                subject VARCHAR(100),
                school VARCHAR(255),
                failed_login_attempts INTEGER DEFAULT 0,
                locked_until TIMESTAMP,
                email_verified BOOLEAN DEFAULT true,
                two_factor_enabled BOOLEAN DEFAULT false,
                two_factor_secret VARCHAR(255)
            )
        `);

        // Create documents table
        await client.query(`
            CREATE TABLE IF NOT EXISTS documents (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                filename VARCHAR(255) NOT NULL,
                original_name VARCHAR(255) NOT NULL,
                file_path VARCHAR(500) NOT NULL,
                file_size BIGINT NOT NULL,
                mime_type VARCHAR(100) NOT NULL,
                category VARCHAR(100),
                description TEXT,
                tags TEXT[],
                is_public BOOLEAN DEFAULT false,
                download_count INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_accessed TIMESTAMP,
                file_hash VARCHAR(255),
                virus_scanned BOOLEAN DEFAULT false,
                scan_result VARCHAR(50) DEFAULT 'pending'
            )
        `);

        // Create file_shares table
        await client.query(`
            CREATE TABLE IF NOT EXISTS file_shares (
                id SERIAL PRIMARY KEY,
                document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE,
                shared_by INTEGER REFERENCES users(id) ON DELETE CASCADE,
                shared_with INTEGER REFERENCES users(id) ON DELETE CASCADE,
                permission VARCHAR(20) DEFAULT 'view',
                expires_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create audit_logs table
        await client.query(`
            CREATE TABLE IF NOT EXISTS audit_logs (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                action VARCHAR(100) NOT NULL,
                resource_type VARCHAR(50) NOT NULL,
                resource_id INTEGER,
                details JSONB,
                ip_address INET,
                user_agent TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                severity VARCHAR(20) DEFAULT 'info',
                success BOOLEAN DEFAULT true
            )
        `);

        // Create security_events table
        await client.query(`
            CREATE TABLE IF NOT EXISTS security_events (
                id SERIAL PRIMARY KEY,
                event_type VARCHAR(100) NOT NULL,
                user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                ip_address INET,
                user_agent TEXT,
                details JSONB,
                severity VARCHAR(20) DEFAULT 'low',
                resolved BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create sessions table for session management
        await client.query(`
            CREATE TABLE IF NOT EXISTS user_sessions (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
                session_token VARCHAR(255) UNIQUE NOT NULL,
                ip_address INET,
                user_agent TEXT,
                expires_at TIMESTAMP NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                is_active BOOLEAN DEFAULT true
            )
        `);

        // Create indexes for better performance
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_documents_user_id ON documents(user_id);
            CREATE INDEX IF NOT EXISTS idx_documents_category ON documents(category);
            CREATE INDEX IF NOT EXISTS idx_documents_created_at ON documents(created_at);
            CREATE INDEX IF NOT EXISTS idx_documents_file_hash ON documents(file_hash);
            CREATE INDEX IF NOT EXISTS idx_file_shares_document_id ON file_shares(document_id);
            CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
            CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
            CREATE INDEX IF NOT EXISTS idx_security_events_created_at ON security_events(created_at);
            CREATE INDEX IF NOT EXISTS idx_security_events_user_id ON security_events(user_id);
            CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
            CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(session_token);
            CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
        `);

        // Create updated_at trigger function
        await client.query(`
            CREATE OR REPLACE FUNCTION update_updated_at_column()
            RETURNS TRIGGER AS $$
            BEGIN
                NEW.updated_at = CURRENT_TIMESTAMP;
                RETURN NEW;
            END;
            $$ language 'plpgsql';
        `);

        // Create triggers for updated_at columns
        await client.query(`
            DROP TRIGGER IF EXISTS update_users_updated_at ON users;
            CREATE TRIGGER update_users_updated_at 
                BEFORE UPDATE ON users 
                FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
                
            DROP TRIGGER IF EXISTS update_documents_updated_at ON documents;
            CREATE TRIGGER update_documents_updated_at 
                BEFORE UPDATE ON documents 
                FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        `);

        // Create admin user if it doesn't exist
        const adminEmail = process.env.ADMIN_EMAIL || 'admin@teachersystem.com';
        const adminPassword = process.env.ADMIN_PASSWORD || 'Admin123!@#';
        
        const existingAdmin = await client.query(
            'SELECT id FROM users WHERE email = $1',
            [adminEmail]
        );

        if (existingAdmin.rows.length === 0) {
            const saltRounds = parseInt(process.env.BCRYPT_ROUNDS) || 12;
            const passwordHash = await bcrypt.hash(adminPassword, saltRounds);
            
            await client.query(
                `INSERT INTO users (email, password_hash, full_name, role, email_verified) 
                 VALUES ($1, $2, $3, $4, $5)`,
                [adminEmail, passwordHash, 'System Administrator', 'admin', true]
            );
            
            console.log('✅ Admin user created successfully');
            console.log(`📧 Admin Email: ${adminEmail}`);
            console.log(`🔑 Admin Password: ${adminPassword}`);
            console.log('⚠️  Please change the admin password after first login!');
        } else {
            console.log('ℹ️  Admin user already exists');
        }

        console.log('✅ Database tables created successfully');
        console.log('✅ Indexes created successfully');
        console.log('✅ Triggers created successfully');
        
    } catch (error) {
        console.error('❌ Database initialization error:', error);
        throw error;
    } finally {
        client.release();
        await pool.end();
    }
}

// Run initialization
initializeDatabase()
    .then(() => {
        console.log('🎉 Database initialization completed successfully!');
        process.exit(0);
    })
    .catch((error) => {
        console.error('💥 Database initialization failed:', error);
        process.exit(1);
    });