const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

// Database setup for Vercel (using Vercel Postgres or external PostgreSQL)
async function setupVercelDatabase() {
    console.log('🔄 Setting up database for Vercel deployment...');
    
    // Use Vercel Postgres connection string or external database
    const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
    
    if (!connectionString) {
        console.log('⚠️  No database connection string found.');
        console.log('Please set POSTGRES_URL or DATABASE_URL environment variable.');
        console.log('You can use:');
        console.log('- Vercel Postgres (recommended)');
        console.log('- Supabase');
        console.log('- Railway');
        console.log('- Any other PostgreSQL service');
        return;
    }

    const pool = new Pool({
        connectionString,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });

    try {
        const client = await pool.connect();
        
        // Create tables
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

        // Create indexes
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_documents_user_id ON documents(user_id);
            CREATE INDEX IF NOT EXISTS idx_documents_category ON documents(category);
            CREATE INDEX IF NOT EXISTS idx_documents_created_at ON documents(created_at);
            CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
        `);

        // Create admin user if it doesn't exist
        const adminEmail = process.env.ADMIN_EMAIL || 'admin@teachersystem.com';
        const adminPassword = process.env.ADMIN_PASSWORD || 'Admin123!@#';
        
        const existingAdmin = await client.query(
            'SELECT id FROM users WHERE email = $1',
            [adminEmail]
        );

        if (existingAdmin.rows.length === 0) {
            const saltRounds = 12;
            const passwordHash = await bcrypt.hash(adminPassword, saltRounds);
            
            await client.query(
                `INSERT INTO users (email, password_hash, full_name, role, email_verified) 
                 VALUES ($1, $2, $3, $4, $5)`,
                [adminEmail, passwordHash, 'System Administrator', 'admin', true]
            );
            
            console.log('✅ Admin user created successfully');
            console.log(`📧 Admin Email: ${adminEmail}`);
            console.log(`🔑 Admin Password: ${adminPassword}`);
        }

        client.release();
        await pool.end();
        
        console.log('✅ Database setup completed successfully for Vercel!');
        
    } catch (error) {
        console.error('❌ Database setup error:', error);
        throw error;
    }
}

// Run setup if called directly
if (require.main === module) {
    setupVercelDatabase()
        .then(() => {
            console.log('🎉 Vercel database setup completed!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('💥 Vercel database setup failed:', error);
            process.exit(1);
        });
}

module.exports = { setupVercelDatabase };