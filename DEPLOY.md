# Hostinger VPS Deployment Guide - RAYAT AL-FURSAN

## Prerequisites

- Hostinger VPS (KVM 1 or higher, Ubuntu 22.04 recommended)
- SSH access to your VPS
- Your project code pushed to a Git repository (GitHub/GitLab)

---

## Step 1: Connect to Your VPS

After purchasing your Hostinger VPS, you'll get an IP address and root password.

```bash
ssh root@YOUR_VPS_IP
```

## Step 2: Initial Server Setup

```bash
# Update system
apt update && apt upgrade -y

# Install essential tools
apt install -y curl git ufw nginx

# Create a non-root user (recommended)
adduser rayat
usermod -aG sudo rayat

# Set up firewall
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw enable
```

## Step 3: Install Node.js 20

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
apt install -y nodejs

# Verify
node -v   # should show v20.x
npm -v
```

## Step 4: Install PM2 (Process Manager)

```bash
npm install -g pm2
```

## Step 5: Clone Your Project

```bash
# Switch to your user
su - rayat

# Clone the repository
git clone YOUR_REPO_URL /home/rayat/rayat-al-fursan
cd /home/rayat/rayat-al-fursan

# Install dependencies
npm ci --omit=dev

# Create uploads directory
mkdir -p uploads
```

## Step 6: Configure Environment

```bash
cp .env.example .env
nano .env
```

**IMPORTANT - Update these values:**

```env
# Generate a random secret (run this command and paste the output):
# node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
SESSION_SECRET=PASTE_YOUR_64_CHAR_SECRET_HERE

PORT=3000
NODE_ENV=production
UPLOAD_MAX_SIZE_MB=10

# Change this! Use a strong password
ADMIN_PASSWORD=your-strong-admin-password

# Email config (optional - for password reset emails)
# For Gmail: enable "App Passwords" in Google Account settings
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=your-email@gmail.com
```

## Step 7: Seed the Database (Optional)

```bash
# Creates sample data (100 users, 10 communities, 100 posts)
npm run seed
```

## Step 8: Start with PM2

```bash
pm2 start ecosystem.config.js --env production

# Save PM2 process list (auto-restart on reboot)
pm2 save

# Set PM2 to start on boot
pm2 startup
# Run the command it outputs (as root if needed)
```

## Step 9: Configure Nginx as Reverse Proxy

```bash
# Switch to root
sudo nano /etc/nginx/sites-available/rayat-al-fursan
```

Paste this configuration:

```nginx
server {
    listen 80;
    server_name YOUR_DOMAIN_OR_IP;

    client_max_body_size 15M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable the site:

```bash
sudo ln -s /etc/nginx/sites-available/rayat-al-fursan /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx
```

Your site is now live at `http://YOUR_VPS_IP`

## Step 10: Add SSL (Free - with a domain)

If you have a domain name:

```bash
# Install Certbot
sudo apt install -y certbot python3-certbot-nginx

# Get SSL certificate
sudo certbot --nginx -d yourdomain.com

# Auto-renewal is set up automatically
```

---

## Useful Commands

```bash
# Check app status
pm2 status

# View logs
pm2 logs rayat-al-fursan

# Restart app
pm2 restart rayat-al-fursan

# Update code from git
cd /home/rayat/rayat-al-fursan
git pull
npm ci --omit=dev
pm2 restart rayat-al-fursan

# Database backup
cp rayat.db rayat-backup-$(date +%Y%m%d).db

# Check disk space
df -h

# Check memory
free -m
```

## Gmail SMTP Setup (for password reset emails)

1. Go to https://myaccount.google.com/security
2. Enable 2-Step Verification
3. Go to "App passwords" (search for it)
4. Create a new app password for "Mail"
5. Copy the 16-character password
6. Use it as `SMTP_PASS` in your .env file
7. Use your Gmail address as both `SMTP_USER` and `SMTP_FROM`

## Alternative: Docker Deployment

If you prefer Docker:

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh

# Run with docker-compose
cd /home/rayat/rayat-al-fursan
docker compose up -d

# View logs
docker compose logs -f
```

## Troubleshooting

- **App won't start:** Check `pm2 logs` for errors
- **502 Bad Gateway:** Nginx can't reach the app. Check if PM2 is running: `pm2 status`
- **Uploads fail:** Check permissions: `chmod 755 uploads/`
- **Database locked:** Only one process should access SQLite. Don't run multiple instances
- **Out of memory:** Check `pm2 monit`. The app restarts at 512MB by default
