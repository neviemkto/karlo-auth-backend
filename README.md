# Karlo's Auth Backend

Shared authentication server for Karlo's games. Handles accounts, progress sync, and password resets.

## Stack
- Node.js + Express
- MongoDB Atlas (free tier)
- JWT auth
- Nodemailer (Gmail)

---

## Step-by-Step Deployment

### 1. MongoDB Atlas (Free Database)
1. Go to [atlas.mongodb.com](https://www.mongodb.com/atlas) → Sign up / Log in
2. Create a **free** cluster (M0 Sandbox)
3. **Database Access** → Add Database User → username + password (save these!)
4. **Network Access** → Add IP Address → Allow Access from Anywhere (0.0.0.0/0)
5. **Connect** → Drivers → Copy connection string
   - Replace `<username>` and `<password>` with your DB user credentials
   - Replace `myFirstDatabase` with `karlos-auth`
   - Looks like: `mongodb+srv://myuser:mypass@cluster0.abc12.mongodb.net/karlos-auth?retryWrites=true&w=majority`

### 2. Gmail App Password (for password reset emails)
1. Go to your Google Account → **Security**
2. Enable **2-Step Verification** if not already
3. Search for **App passwords** → Select app: Mail → Select device: Other → type "Karlo Server"
4. Google gives you a 16-char code like `xxxx xxxx xxxx xxxx` — save it!

### 3. GitHub Repository
```bash
# In this folder:
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/karlo-auth-backend.git
git push -u origin main
```

### 4. Render.com Deployment
1. Go to [render.com](https://render.com) → Sign up with GitHub
2. **New** → **Web Service**
3. Connect your `karlo-auth-backend` repo
4. Settings:
   - **Name:** karlo-auth-backend
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Plan:** Free
5. **Environment Variables** → Add these:
   | Key | Value |
   |-----|-------|
   | `MONGO_URI` | Your Atlas connection string |
   | `JWT_SECRET` | A random 64+ char string |
   | `EMAIL_USER` | your.gmail@gmail.com |
   | `EMAIL_PASS` | Your 16-char App Password (no spaces) |
   | `ALLOWED_ORIGINS` | https://k4rl0.itch.io,https://yoursite.com |
   | `GAME_URL` | https://yoursite.com |
6. Click **Create Web Service**
7. Wait ~2 minutes for deployment
8. Your server URL will be: `https://karlo-auth-backend.onrender.com`

### 5. Update the Game Frontend
In `index.html`, find this line near the top of the auth script:
```js
const KARLO_AUTH_URL = 'YOUR_RENDER_URL_HERE';
```
Replace with your actual Render URL:
```js
const KARLO_AUTH_URL = 'https://karlo-auth-backend.onrender.com';
```

---

## API Reference

| Endpoint | Method | Auth | Body | Description |
|----------|--------|------|------|-------------|
| `/health` | GET | No | — | Check server is alive |
| `/api/auth/register` | POST | No | `{username, email, password}` | Create account |
| `/api/auth/login` | POST | No | `{email, password}` | Log in |
| `/api/auth/forgot-password` | POST | No | `{email, gameUrl}` | Send reset email |
| `/api/auth/reset-password` | POST | No | `{token, newPassword}` | Reset password |
| `/api/progress` | GET | JWT | — | Load cloud save |
| `/api/progress/save` | POST | JWT | `{gameId, data}` | Save cloud save |

## Using with Future Games
Set `gameId` to a different string for each game. Progress is stored per-user per-gameId, so accounts work across all your games but each game has separate saves.

---

## Free Tier Notes
- **Render free tier:** Server sleeps after 15 minutes of inactivity. First request after sleep takes ~30 seconds to wake up. This is fine — the game shows a "Connecting..." state while it wakes.
- **MongoDB Atlas free tier:** 512MB storage, plenty for player progress.
