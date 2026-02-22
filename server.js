require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

const app = express();

// ── CORS — allow all Karlo game domains ───────────────────────────────────────
app.use(cors({
    origin: function (origin, callback) {
        // This tells the server to accept connections from literally ANYWHERE, 
        // including local computer files (origin 'null') and web portals.
        callback(null, true);
    },
    credentials: true
}));

app.use(express.json({ limit: '2mb' }));

// ── MongoDB ───────────────────────────────────────────────────────────────────
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ MongoDB connected'))
    .catch(err => { console.error('❌ MongoDB error:', err); process.exit(1); });

// ── Schemas ───────────────────────────────────────────────────────────────────
const userSchema = new mongoose.Schema({
    username:    { type: String, required: true, unique: true, trim: true, minlength: 3, maxlength: 20 },
    email:       { type: String, required: true, unique: true, lowercase: true, trim: true },
    password:    { type: String, required: true },
    createdAt:   { type: Date, default: Date.now },
    resetToken:  { type: String, default: null },
    resetExpiry: { type: Date, default: null }
});

// Store per-game progress. gameId lets you reuse this server across all your games.
const progressSchema = new mongoose.Schema({
    userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    gameId:    { type: String, required: true, default: 'karlos_td' },
    data:      { type: mongoose.Schema.Types.Mixed, default: {} },
    updatedAt: { type: Date, default: Date.now }
});
progressSchema.index({ userId: 1, gameId: 1 }, { unique: true });

const User     = mongoose.model('User', userSchema);
const Progress = mongoose.model('Progress', progressSchema);

// ── Email transporter (Brevo API) ─────────────────────────────────────────────
async function sendResetEmail(toEmail, resetToken, gameUrl) {
    const resetLink = `${gameUrl}?reset=${resetToken}`;
    
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
            'accept': 'application/json',
            'api-key': process.env.BREVO_API_KEY,
            'content-type': 'application/json'
        },
        body: JSON.stringify({
            sender: { 
                email: process.env.EMAIL_USER, // Uses the email from your Render environment
                name: "Karlo's Login" 
            },
            to: [{ email: toEmail }],
            subject: "Password Reset — Karlo's Login",
            htmlContent: `
            <div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;background:#0d0d18;color:#fff;border-radius:12px;overflow:hidden;">
                <div style="background:linear-gradient(135deg,#e67e22,#f1c40f);padding:24px;text-align:center;">
                    <h2 style="margin:0;font-size:22px;letter-spacing:2px;">⚡ KARLO'S LOGIN</h2>
                </div>
                <div style="padding:32px;">
                    <p style="font-size:15px;color:#ccc;">Someone requested a password reset for your account.</p>
                    <p style="font-size:15px;color:#ccc;">Click the button below to reset your password. This link expires in <strong>1 hour</strong>.</p>
                    <div style="text-align:center;margin:32px 0;">
                        <a href="${resetLink}" style="background:linear-gradient(135deg,#e67e22,#f1c40f);color:#000;text-decoration:none;padding:14px 32px;border-radius:8px;font-weight:900;letter-spacing:2px;font-size:14px;">RESET PASSWORD</a>
                    </div>
                    <p style="font-size:12px;color:#666;">If you didn't request this, ignore this email. Your password won't change.</p>
                    <p style="font-size:11px;color:#444;word-break:break-all;">Link: ${resetLink}</p>
                </div>
            </div>
            `
        })
    });

    if (!res.ok) {
        const err = await res.json();
        console.error("Brevo Error:", err);
        throw new Error('Failed to send email');
    }
}

// ── Auth middleware ───────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) return res.status(401).json({ error: 'Not authenticated' });
    try {
        req.user = jwt.verify(header.slice(7), process.env.JWT_SECRET);
        next();
    } catch {
        res.status(401).json({ error: 'Token expired or invalid — please log in again' });
    }
}

// ── Routes ────────────────────────────────────────────────────────────────────

// POST /api/auth/register
app.post('/api/auth/register', async (req, res) => {
    try {
        let { username, email, password } = req.body;
        if (!username || !email || !password) return res.status(400).json({ error: 'All fields are required' });
        username = username.trim();
        email    = email.toLowerCase().trim();

        if (username.length < 3)  return res.status(400).json({ error: 'Username must be at least 3 characters' });
        if (username.length > 20) return res.status(400).json({ error: 'Username must be 20 characters or fewer' });
        if (password.length < 6)  return res.status(400).json({ error: 'Password must be at least 6 characters' });
        if (!/\S+@\S+\.\S+/.test(email)) return res.status(400).json({ error: 'Invalid email address' });

        const existingEmail    = await User.findOne({ email });
        const existingUsername = await User.findOne({ username: new RegExp(`^${username}$`, 'i') });
        if (existingEmail)    return res.status(409).json({ error: 'An account with that email already exists' });
        if (existingUsername) return res.status(409).json({ error: 'That username is already taken' });

        const hashed = await bcrypt.hash(password, 12);
        const user   = await User.create({ username, email, password: hashed });
        const token  = jwt.sign({ userId: user._id, username: user.username }, process.env.JWT_SECRET, { expiresIn: '90d' });

        res.json({ token, username: user.username, userId: user._id });
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ error: 'Server error — try again' });
    }
});

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
    try {
        let { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
        email = email.toLowerCase().trim();

        const user = await User.findOne({ email });
        if (!user) return res.status(401).json({ error: 'No account found with that email' });

        const valid = await bcrypt.compare(password, user.password);
        if (!valid) return res.status(401).json({ error: 'Incorrect password' });

        const token = jwt.sign({ userId: user._id, username: user.username }, process.env.JWT_SECRET, { expiresIn: '90d' });
        res.json({ token, username: user.username, userId: user._id });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: 'Server error — try again' });
    }
});

// POST /api/auth/forgot-password
app.post('/api/auth/forgot-password', async (req, res) => {
    try {
        const { email, gameUrl } = req.body;
        if (!email) return res.status(400).json({ error: 'Email is required' });

        const user = await User.findOne({ email: email.toLowerCase().trim() });
        // Always return success to not reveal whether email exists
        if (!user) return res.json({ message: 'If that email is registered, a reset link has been sent.' });

        const token  = uuidv4();
        const expiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

        await User.updateOne({ _id: user._id }, { resetToken: token, resetExpiry: expiry });
        await sendResetEmail(user.email, token, gameUrl || process.env.GAME_URL || 'https://yoursite.com');

        res.json({ message: 'If that email is registered, a reset link has been sent.' });
    } catch (err) {
        console.error('Forgot password error:', err);
        res.status(500).json({ error: 'Could not send email — try again later' });
    }
});

// POST /api/auth/reset-password
app.post('/api/auth/reset-password', async (req, res) => {
    try {
        const { token, newPassword } = req.body;
        if (!token || !newPassword) return res.status(400).json({ error: 'Token and new password are required' });
        if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

        const user = await User.findOne({ resetToken: token, resetExpiry: { $gt: new Date() } });
        if (!user) return res.status(400).json({ error: 'Reset link is invalid or has expired' });

        const hashed = await bcrypt.hash(newPassword, 12);
        await User.updateOne({ _id: user._id }, { password: hashed, resetToken: null, resetExpiry: null });

        res.json({ message: 'Password updated successfully — you can now log in' });
    } catch (err) {
        console.error('Reset password error:', err);
        res.status(500).json({ error: 'Server error — try again' });
    }
});

// GET /api/progress?gameId=karlos_td
app.get('/api/progress', requireAuth, async (req, res) => {
    try {
        const gameId = req.query.gameId || 'karlos_td';
        const record = await Progress.findOne({ userId: req.user.userId, gameId });
        res.json({ data: record ? record.data : null });
    } catch (err) {
        res.status(500).json({ error: 'Could not load progress' });
    }
});

// POST /api/progress/save
app.post('/api/progress/save', requireAuth, async (req, res) => {
    try {
        const gameId = req.body.gameId || 'karlos_td';
        const data   = req.body.data;
        if (!data) return res.status(400).json({ error: 'No data provided' });

        await Progress.findOneAndUpdate(
            { userId: req.user.userId, gameId },
            { data, updatedAt: new Date() },
            { upsert: true, new: true }
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Could not save progress' });
    }
});

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Karlo Auth Server running on port ${PORT}`));
