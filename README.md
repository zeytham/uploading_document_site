# Teacher Document Management System 📚

Mfumo wa kisasa wa usimamizi wa hati kwa ajili ya walimu. Sistema hii inawezesha walimu kupakua, kuhifadhi, na kusimamia hati zao kwa usalama na urahisi.

## ✨ Vipengele Muhimu

### 🔐 Usalama wa Hali ya Juu
- **Brute Force Protection**: Kinga dhidi ya mashambulizi ya kuweka nenosiri mara nyingi
- **Account Lockout**: Akaunti inafungwa baada ya majaribio mabaya ya kuingia
- **Password Strength Validation**: Uhakiki wa nguvu za nenosiri
- **Input Sanitization**: Kusafisha data zinazoingia
- **Rate Limiting**: Kiwango cha maombi kwa muda fulani
- **Security Headers**: Vichwa vya usalama vya HTTP
- **Audit Logging**: Kumbuka za shughuli zote muhimu

### 📁 Usimamizi wa Faili
- **Multi-file Upload**: Upakuaji wa faili nyingi kwa wakati mmoja
- **Drag & Drop**: Buruta na udondoshe faili
- **File Preview**: Muhtasari wa faili (PDF, Word, picha, nakadhalika)
- **File Categories**: Vikundi vya faili (hati, picha, maonyesho, nakadhalika)
- **Search & Filter**: Utafutaji na kuchuja faili
- **Download Tracking**: Kufuatilia idadi ya download

### 👤 Usimamizi wa Watumiaji
- **User Registration**: Usajili wa watumiaji mpya
- **Profile Management**: Usimamizi wa wasifu wa mtumiaji
- **Role-based Access**: Ufikiaji kulingana na jukumu
- **Admin Dashboard**: Dashibodi ya msimamizi

### 🎨 Mazingira ya Mtumiaji
- **Modern Grey Theme**: Mandhari ya kisasa ya rangi za kijivu
- **Responsive Design**: Muundo unaobadilika kulingana na kifaa
- **Intuitive Interface**: Mazingira rahisi ya kutumia
- **Real-time Notifications**: Arifa za wakati halisi

## 🚀 Usakinishaji

### Mahitaji ya Msingi
- Node.js 16+ 
- PostgreSQL 12+
- npm au yarn

### 1. Clone Repository
```bash
git clone <repository-url>
cd teacher-document-system
```

### 2. Sakinisha Dependencies
```bash
npm install
```

### 3. Sanidi Environment Variables
Nakili `.env.example` kwenda `.env` na ubadilishe maadili:

```bash
cp .env.example .env
```

Hariri `.env` file:
```env
# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=teacher_documents
DB_USER=your_db_user
DB_PASSWORD=your_strong_password

# JWT Configuration  
JWT_SECRET=your_very_long_and_random_secret_key_here
JWT_EXPIRES_IN=7d

# Admin Configuration
ADMIN_EMAIL=admin@yourdomain.com
ADMIN_PASSWORD=YourStrongAdminPassword123!
```

### 4. Unda Database
```bash
# Unda database
createdb teacher_documents

# Au kwa kutumia PostgreSQL CLI
psql -U postgres -c "CREATE DATABASE teacher_documents;"
```

### 5. Initialize Database
```bash
npm run init-db
```

### 6. Anza Server
```bash
# Development
npm run dev

# Production
npm start
```

Server itaanza kwenye `http://localhost:3000`

## 🐳 Docker Deployment

### Usakinishaji wa Haraka na Docker Compose
```bash
# Clone repository
git clone <repository-url>
cd teacher-document-system

# Unda .env file
cp .env.example .env
# Hariri .env file na weka maadili sahihi

# Anza services zote
docker-compose up -d

# Angalia logs
docker-compose logs -f app
```

### Manual Docker Build
```bash
# Build image
docker build -t teacher-docs .

# Run container
docker run -d \
  --name teacher-docs-app \
  -p 3000:3000 \
  -e DB_HOST=your_db_host \
  -e DB_PASSWORD=your_db_password \
  -e JWT_SECRET=your_jwt_secret \
  teacher-docs
```

## 🌐 Production Deployment

### 1. Server Setup (Ubuntu/Debian)
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install PostgreSQL
sudo apt install postgresql postgresql-contrib

# Install PM2 for process management
sudo npm install -g pm2
```

### 2. Database Setup
```bash
# Switch to postgres user
sudo -u postgres psql

# Create database and user
CREATE DATABASE teacher_documents;
CREATE USER teacher_user WITH PASSWORD 'strong_password';
GRANT ALL PRIVILEGES ON DATABASE teacher_documents TO teacher_user;
\q
```

### 3. Application Deployment
```bash
# Clone and setup application
git clone <repository-url> /var/www/teacher-docs
cd /var/www/teacher-docs

# Install dependencies
npm ci --production

# Setup environment
cp .env.example .env
# Edit .env with production values

# Initialize database
npm run init-db

# Start with PM2
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

### 4. Nginx Configuration
```nginx
server {
    listen 80;
    server_name yourdomain.com;
    
    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com;
    
    # SSL Configuration
    ssl_certificate /path/to/your/certificate.crt;
    ssl_certificate_key /path/to/your/private.key;
    
    # Security headers
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";
    
    # File upload limit
    client_max_body_size 50M;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
    
    # Static files
    location /uploads {
        alias /var/www/teacher-docs/uploads;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

## 📝 Matumizi

### Kuingia kwa Mara ya Kwanza
1. Fungua `http://localhost:3000` (au domain yako)
2. Bofya "Sign up" kuunda akaunti mpya
3. Jaza taarifa zako (jina, email, nenosiri)
4. Baada ya kujiandikisha, utaweza kuingia

### Admin Access
- **Email**: `admin@teachersystem.com` (au ulichoweka katika .env)
- **Password**: `Admin123!@#` (au ulichoweka katika .env)
- **⚠️ Muhimu**: Badilisha nenosiri la admin baada ya kuingia kwa mara ya kwanza!

### Kupakia Faili
1. Ingia kwenye "Upload" page
2. Buruta faili au bofya ili kuchagua
3. Faili zitapakiwa kiotomatiki
4. Unaweza kuongeza maelezo na tags

### Kusimamia Faili
- **Preview**: Bofya jicho kuona muhtasari
- **Download**: Bofya kitufe cha download
- **Edit**: Hariri maelezo ya faili
- **Delete**: Futa faili (hakika utaulizwa)

## 🔧 API Documentation

### Authentication Endpoints
```
POST /api/auth/register - Jiandikishe mtumiaji mpya
POST /api/auth/login    - Ingia
GET  /api/auth/profile  - Pata taarifa za wasifu
PUT  /api/auth/profile  - Sasisha wasifu
POST /api/auth/logout   - Toka
```

### File Management Endpoints
```
POST   /api/files/upload     - Pakia faili
GET    /api/files           - Pata orodha ya faili
GET    /api/files/:id       - Pata taarifa za faili
GET    /api/files/:id/download - Download faili
GET    /api/files/:id/preview  - Preview faili
PUT    /api/files/:id       - Sasisha taarifa za faili
DELETE /api/files/:id       - Futa faili
```

## 🛡️ Usalama

Sistema hii ina vipengele vya usalama vya hali ya juu:

- **Encryption**: Data zote za siri zinasimbwa
- **HTTPS**: Mawasiliano yote yamehifadhiwa
- **Input Validation**: Uhakiki wa data zote zinazoingia
- **SQL Injection Protection**: Kinga dhidi ya mashambulizi ya SQL
- **XSS Protection**: Kinga dhidi ya Cross-Site Scripting
- **CSRF Protection**: Kinga dhidi ya Cross-Site Request Forgery
- **Rate Limiting**: Kuzuia maombi mengi
- **File Type Validation**: Uhakiki wa aina za faili
- **Virus Scanning**: Uchunguzi wa virusi (optional)

## 📊 Monitoring na Logs

### Application Logs
```bash
# View logs with PM2
pm2 logs teacher-docs

# View specific log files
tail -f logs/app.log
tail -f logs/error.log
tail -f logs/security.log
```

### Database Monitoring
```sql
-- Check active connections
SELECT * FROM pg_stat_activity WHERE datname = 'teacher_documents';

-- Check table sizes
SELECT schemaname,tablename,pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size 
FROM pg_tables WHERE schemaname = 'public';

-- Check recent security events
SELECT * FROM security_events ORDER BY created_at DESC LIMIT 10;
```

## 🔄 Backup na Recovery

### Database Backup
```bash
# Create backup
pg_dump -U teacher_user -h localhost teacher_documents > backup_$(date +%Y%m%d_%H%M%S).sql

# Automated daily backup
echo "0 2 * * * pg_dump -U teacher_user teacher_documents > /backups/db_$(date +\%Y\%m\%d).sql" | crontab -
```

### File Backup
```bash
# Backup uploads directory
tar -czf uploads_backup_$(date +%Y%m%d).tar.gz uploads/

# Sync to remote storage (example with rsync)
rsync -av uploads/ user@backup-server:/backups/teacher-docs/uploads/
```

## 🚨 Troubleshooting

### Matatizo ya Kawaida

**1. Database Connection Error**
```bash
# Check PostgreSQL status
sudo systemctl status postgresql

# Check connection
psql -U teacher_user -h localhost -d teacher_documents
```

**2. File Upload Issues**
- Angalia permissions za uploads directory
- Hakikisha MAX_FILE_SIZE ni sahihi
- Angalia disk space

**3. Memory Issues**
```bash
# Check memory usage
free -h
pm2 monit

# Restart application
pm2 restart teacher-docs
```

**4. SSL Certificate Issues**
```bash
# Check certificate validity
openssl x509 -in certificate.crt -text -noout

# Renew Let's Encrypt certificate
certbot renew
```

## 🤝 Michango

Tunakaribisha michango! Tafadhali:

1. Fork repository
2. Unda branch mpya (`git checkout -b feature/kipengele-kipya`)
3. Commit mabadiliko yako (`git commit -am 'Ongeza kipengele kipya'`)
4. Push branch (`git push origin feature/kipengele-kipya`)
5. Unda Pull Request

## 📄 License

Mradi huu unatumia leseni ya MIT. Angalia faili ya `LICENSE` kwa maelezo zaidi.

## 📞 Msaada

Kama una swali au tatizo:

1. Angalia documentation hii kwanza
2. Tafuta katika GitHub Issues
3. Unda issue mpya na maelezo kamili
4. Wasiliana na timu ya development

---

**🎉 Asante kwa kutumia Teacher Document Management System!**

Sistema hii imeundwa kwa upendo na makini kwa ajili ya walimu wetu. Tunaamini itakusaidia kusimamia hati zako kwa urahisi na usalama.