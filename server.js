const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const { IMAGE_TYPES, detectImageType, imageFilename, isUploadFilename } = require('./lib/image-validation');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, maxPayload: 64 * 1024 });
const connectionString = process.env.DATABASE_URL;
const resumeTokenSecret = process.env.RESUME_TOKEN_SECRET;
const uploadDir = path.join(__dirname, 'public', 'uploads');
const RESUME_TOKEN_TTL_MS = 8 * 60 * 60 * 1000;
const uploadTickets = new Map();
const uploadedImages = new Map();
const HISTORY_LIMIT = 50;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const TICKET_LIFETIME_MS = 60 * 1000;
const MAX_MESSAGE_LENGTH = 4000;
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
let currentTheme = 'default';
let currentTitle = 'Classroom';

if (!connectionString || !resumeTokenSecret) {
    console.error('DATABASE_URL and RESUME_TOKEN_SECRET environment variables are required');
    process.exit(1);
}

const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false }
});

async function initDatabase() {
    try {
        const result = await pool.query('SELECT NOW()');
        console.log('Database connected successfully:', result.rows[0].now);
        await pool.query('SELECT username, is_admin FROM users LIMIT 1');
        await pool.query('SELECT id, image_url, image_expires_at FROM current_chat LIMIT 1');
        await pool.query('SELECT id, image_url, image_expires_at FROM history_archive LIMIT 1');
    } catch (err) {
        console.error('Database schema or connection error:', err.message);
        process.exit(1);
    }
}

function ticketFromRequest(req) {
    const authorization = req.get('authorization') || '';
    return authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
}

function removeExpiredTickets() {
    const now = Date.now();
    for (const [ticket, data] of uploadTickets) {
        if (data.expiresAt <= now) uploadTickets.delete(ticket);
    }
}

function issueResumeToken(username) {
    const payload = Buffer.from(JSON.stringify({ v: 1, sub: username, exp: Date.now() + RESUME_TOKEN_TTL_MS })).toString('base64url');
    const signature = crypto.createHmac('sha256', resumeTokenSecret).update(payload).digest('base64url');
    return `${payload}.${signature}`;
}

function readResumeToken(token) {
    if (typeof token !== 'string' || token.length > 1024) return null;
    const [payload, signature, extra] = token.split('.');
    if (!payload || !signature || extra) return null;
    const expected = crypto.createHmac('sha256', resumeTokenSecret).update(payload).digest();
    let received;
    try { received = Buffer.from(signature, 'base64url'); } catch { return null; }
    if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) return null;
    try {
        const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        if (data.v !== 1 || typeof data.sub !== 'string' || !data.sub || data.sub.length > 20 || !Number.isSafeInteger(data.exp) || data.exp <= Date.now()) return null;
        return data;
    } catch { return null; }
}

app.post('/api/uploads/images', express.raw({ type: '*/*', limit: MAX_IMAGE_BYTES }), async (req, res) => {
    removeExpiredTickets();
    const ticket = ticketFromRequest(req);
    const ticketData = uploadTickets.get(ticket);
    uploadTickets.delete(ticket);

    if (!ticketData || ticketData.expiresAt <= Date.now()) {
        return res.status(401).json({ error: 'Invalid or expired upload ticket.' });
    }

    const claimedType = req.get('content-type')?.split(';')[0].toLowerCase();
    const detectedType = Buffer.isBuffer(req.body) ? detectImageType(req.body) : null;
    if (!IMAGE_TYPES[claimedType] || claimedType !== detectedType) {
        return res.status(415).json({ error: 'Use PNG, JPEG, GIF, or WebP images only.' });
    }

    try {
        const filename = imageFilename(detectedType);
        await fs.writeFile(path.join(uploadDir, filename), req.body, { flag: 'wx' });
        const imageUrl = `/uploads/${filename}`;
        uploadedImages.set(imageUrl, { username: ticketData.username, expiresAt: Date.now() + IMAGE_LIFETIME_MS });
        res.set('X-Content-Type-Options', 'nosniff');
        return res.status(201).json({ imageUrl });
    } catch (error) {
        console.error('Image upload failed:', error.message);
        return res.status(500).json({ error: 'Image upload failed.' });
    }
});

app.use('/uploads', express.static(uploadDir, { fallthrough: false, setHeaders(res) { res.set('X-Content-Type-Options', 'nosniff'); } }));
app.use(express.static(path.join(__dirname, 'public')));
app.use((error, req, res, next) => {
    if (error.type === 'entity.too.large') return res.status(413).json({ error: 'Images must be 5 MiB or smaller.' });
    return next(error);
});

wss.on('connection', async (ws, req) => {
    const ip = req.socket.remoteAddress;
    ws.userData = { username: '', color: '#00ff00', ip, isAdmin: false, isLoggedIn: false };
    console.log(`New connection from ${ip}`);
    ws.send(JSON.stringify({ type: 'theme', theme: currentTheme }));
    ws.send(JSON.stringify({ type: 'title', title: currentTitle }));
    ws.send(JSON.stringify({ type: 'system', content: 'Welcome! Please login or register.' }));

    // Idle timeout: disconnect if no activity for 30 min
    let idleTimer = null;
    function resetIdleTimer() {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'system', content: 'Disconnected due to inactivity (30 min).' }));
                ws.close();
            }
        }, IDLE_TIMEOUT_MS);
    }
    resetIdleTimer();

    ws.on('message', async message => {
        try {
            resetIdleTimer();
            const data = JSON.parse(message.toString());
            if (data.type === 'resume') {
                const resume = readResumeToken(data.token);
                if (!resume) return authError(ws, 'resume', 'Session expired. Please login again.');
                const result = await pool.query('SELECT username, is_admin FROM users WHERE username = $1', [resume.sub]);
                if (!result.rows[0]) return authError(ws, 'resume', 'Session expired. Please login again.');
                await loginUser(ws, result.rows[0].username, result.rows[0].is_admin, { resumed: true, loadHistory: data.loadHistory === true });
            } else if (data.type === 'message') {
                const content = typeof data.content === 'string' ? data.content.trim() : '';
                if (content.startsWith('/')) await handleCommand(ws, content);
                else if (!ws.userData.isLoggedIn) sendSystem(ws, 'Please login first.');
                else if (!content) return;
                else if (content.length > MAX_MESSAGE_LENGTH) sendSystem(ws, 'Message is too long.');
                else await saveAndBroadcast(ws.userData.username, ws.userData.color, content);
            } else if (data.type === 'image_upload_ticket') {
                if (!ws.userData.isLoggedIn) return sendSystem(ws, 'Please login first.');
                const ticket = crypto.randomBytes(32).toString('hex');
                const expiresAt = Date.now() + TICKET_LIFETIME_MS;
                uploadTickets.set(ticket, { username: ws.userData.username, expiresAt });
                ws.send(JSON.stringify({ type: 'image_upload_ticket', ticket, expiresAt }));
            } else if (data.type === 'image_message') {
                await handleImageMessage(ws, data);
            } else if (data.type === 'update_color' && ws.userData.isLoggedIn) {
                ws.userData.color = data.content;
            } else if (data.type === 'update_name' && ws.userData.isLoggedIn) {
                sendSystem(ws, 'Cannot change username while logged in.');
            }
        } catch (error) {
            console.error('WS Error:', error.message);
            sendSystem(ws, 'Invalid message format');
        }
    });

    ws.on('close', () => { if (idleTimer) clearTimeout(idleTimer); });
    ws.on('error', error => console.error('WebSocket error:', error.message));
});

function sendSystem(ws, content) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'system', content }));
}

async function handleImageMessage(ws, data) {
    if (!ws.userData.isLoggedIn) return sendSystem(ws, 'Please login first.');
    const imageUrl = typeof data.imageUrl === 'string' ? data.imageUrl : '';
    const uploaded = uploadedImages.get(imageUrl);
    const content = typeof data.content === 'string' ? data.content.trim() : '';
    if (!uploaded || uploaded.username !== ws.userData.username || uploaded.expiresAt <= Date.now()) {
        return sendSystem(ws, 'Invalid or expired image upload.');
    }
    if (content.length > MAX_MESSAGE_LENGTH) return sendSystem(ws, 'Caption is too long.');
    uploadedImages.delete(imageUrl);
    await saveAndBroadcast(ws.userData.username, ws.userData.color, content, imageUrl, new Date(uploaded.expiresAt).toISOString());
}

async function handleCommand(ws, content) {
    const parts = content.split(' ');
    const cmd = parts[0].toLowerCase();

    if (cmd === '/register') {
        const username = parts[1]?.trim();
        const password = parts.slice(2).join(' ');
        if (!username || !password) return authError(ws, 'signup', 'Usage: /register <username> <password>');
        if (username.length > 20) return authError(ws, 'signup', 'Username must be 20 characters or less');
        if (password.length < 4) return authError(ws, 'signup', 'Password must be at least 4 characters');
        try {
            const hash = await bcrypt.hash(password, 10);
            await pool.query('INSERT INTO users (username, password_hash, personal_note) VALUES ($1, $2, $3)', [username, hash, '']);
            await loginUser(ws, username, false);
        } catch (error) {
            authError(ws, 'signup', error.code === '23505' ? 'Username already taken' : 'Registration failed. Please try again.');
        }
        return;
    }

    if (cmd === '/login') {
        const username = parts[1]?.trim();
        const password = parts.slice(2).join(' ');
        if (!username || !password) return authError(ws, 'login', 'Usage: /login <username> <password>');
        try {
            const userRes = await pool.query('SELECT username, password_hash, is_admin FROM users WHERE username = $1', [username]);
            const user = userRes.rows[0];
            if (!user || !(await bcrypt.compare(password, user.password_hash))) return authError(ws, 'login', 'Invalid username or password');
            await loginUser(ws, user.username, user.is_admin);
        } catch (error) {
            console.error('Login error:', error.message);
            authError(ws, 'login', 'Login failed. Please try again.');
        }
        return;
    }

    if (!ws.userData.isLoggedIn) return sendSystem(ws, 'Please login first.');

    if (cmd === '/note') {
        const noteContent = parts.slice(1).join(' ');
        try {
            if (!noteContent) {
                const result = await pool.query('SELECT personal_note FROM users WHERE username = $1', [ws.userData.username]);
                return sendSystem(ws, result.rows[0]?.personal_note ? `Your note: ${result.rows[0].personal_note}` : 'You have no note set.\nUsage: /note <your note text>');
            }
            await pool.query('UPDATE users SET personal_note = $1 WHERE username = $2', [noteContent, ws.userData.username]);
            return sendSystem(ws, `Note saved: ${noteContent}`);
        } catch (error) { return sendSystem(ws, 'Failed to access note'); }
    }

    if (cmd === '/profile' || cmd === '/me') return sendSystem(ws, `Profile: ${ws.userData.username}\nColor: ${ws.userData.color}\nAdmin: ${ws.userData.isAdmin ? 'Yes' : 'No'}`);

    if (cmd === '/whois') {
        const targetUser = parts[1];
        if (!targetUser) return sendSystem(ws, 'Usage: /whois <username>');
        const result = await pool.query('SELECT username FROM users WHERE username = $1', [targetUser]);
        if (!result.rows[0]) return sendSystem(ws, `User '${targetUser}' not found`);
        const isOnline = [...wss.clients].some(client => client.userData.username === targetUser && client.readyState === WebSocket.OPEN);
        return sendSystem(ws, `Profile: ${targetUser}\nStatus: ${isOnline ? 'Online' : 'Offline'}`);
    }

    if (cmd === '/tdtu') return sendSystem(ws, 'Ton Duc Thang University');
    if (cmd === '/rainbow') { ws.userData.color = 'rainbow'; return sendSystem(ws, 'Rainbow mode activated!'); }

    if (cmd === '/dm' || cmd === '/msg') {
        const targetUser = parts[1];
        const message = parts.slice(2).join(' ');
        if (!targetUser || !message) return sendSystem(ws, 'Usage: /dm <username> <message>');
        let sent = false;
        wss.clients.forEach(client => {
            if (client.userData.username === targetUser && client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: 'dm', from: ws.userData.username, to: targetUser, content: message, color: ws.userData.color }));
                sent = true;
            }
        });
        return sent ? ws.send(JSON.stringify({ type: 'dm', from: ws.userData.username, to: targetUser, content: message, color: ws.userData.color })) : sendSystem(ws, `User '${targetUser}' not found or offline`);
    }

    if (cmd === '/users' || cmd === '/who') {
        const onlineUsers = [...wss.clients].filter(client => client.userData.isLoggedIn).map(client => client.userData.username);
        return sendSystem(ws, `Online users (${onlineUsers.length}): ${onlineUsers.join(', ')}`);
    }
    if (cmd === '/ping') return ws.send(JSON.stringify({ type: 'pong', startTime: Date.now() }));
    if (cmd === '/cls' || cmd === '/clear') return ws.send(JSON.stringify({ type: 'clear_history' }));

    if (cmd === '/theme') {
        if (!ws.userData.isAdmin) return sendSystem(ws, 'Admin access required.');
        const theme = parts[1]?.toLowerCase();
        const validThemes = ['default', 'purple', 'blue', 'red'];
        if (!validThemes.includes(theme)) return sendSystem(ws, `Invalid theme. Available: ${validThemes.join(', ')}`);
        currentTheme = theme;
        broadcast(JSON.stringify({ type: 'theme', theme }));
        return;
    }

    if (cmd === '/title') {
        if (!ws.userData.isAdmin) return sendSystem(ws, 'Admin access required.');
        const title = parts.slice(1).join(' ').slice(0, 100);
        if (!title) return sendSystem(ws, `Usage: /title <new title>\nCurrent title: ${currentTitle}`);
        currentTitle = title;
        broadcast(JSON.stringify({ type: 'title', title }));
        return;
    }

    if (cmd === '/db') {
        if (!ws.userData.isAdmin) return sendSystem(ws, 'Admin access required.');
        try {
            const result = await pool.query('SELECT id, username, content, image_url, image_expires_at, timestamp FROM current_chat ORDER BY timestamp DESC LIMIT 100');
            return ws.send(JSON.stringify({ type: 'database_view', data: result.rows }));
        } catch (error) { return sendSystem(ws, 'Database query failed'); }
    }

    if (cmd === '/remove') {
        if (!ws.userData.isAdmin) return sendSystem(ws, 'Admin access required.');
        const id = Number(parts[1]);
        if (!Number.isSafeInteger(id) || id < 1) return sendSystem(ws, 'Usage: /remove <image message id>');
        try {
            const result = await pool.query('UPDATE current_chat SET image_url = NULL, image_expires_at = NULL WHERE id = $1 AND image_url IS NOT NULL RETURNING image_url', [id]);
            if (!result.rows[0]) return sendSystem(ws, 'Image message not found.');
            await deleteImageFile(result.rows[0].image_url);
            broadcast(JSON.stringify({ type: 'image_removed', id }));
            return sendSystem(ws, `Image removed from message ${id}.`);
        } catch (error) { return sendSystem(ws, 'Image removal failed.'); }
    }

    if (cmd === '/archive') {
        if (!ws.userData.isAdmin) return sendSystem(ws, 'Admin access required.');
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query('INSERT INTO history_archive (id, username, content, image_url, image_expires_at, timestamp) SELECT id, username, content, image_url, image_expires_at, timestamp FROM current_chat');
            await client.query('DELETE FROM current_chat');
            await client.query('COMMIT');
            broadcast(JSON.stringify({ type: 'clear_history' }));
            return sendSystem(ws, 'Chat archived and cleared');
        } catch (error) {
            await client.query('ROLLBACK');
            return sendSystem(ws, 'Archive failed');
        } finally {
            client.release();
        }
    }

    if (cmd === '/?') {
        const admin = ws.userData.isAdmin ? '\nAdmin Commands:\n/theme <n>\n/title <text>\n/db\n/remove <image message id>\n/archive' : '';
        return sendSystem(ws, `/tdtu\n/rainbow\n/note [text]\n/profile\n/whois <user>\n/dm <user> <msg>\n/users\n/ping\n/cls${admin}`);
    }
}

function authError(ws, form, message) {
    ws.send(JSON.stringify({ type: 'auth_error', form, message }));
}

async function loginUser(ws, username, isAdmin, { resumed = false, loadHistory = true } = {}) {
    ws.userData.username = username;
    ws.userData.isLoggedIn = true;
    ws.userData.isAdmin = Boolean(isAdmin);
    ws.userData.color = getRandomColor();
    ws.send(JSON.stringify({ type: 'auth_success', message: 'Login successful!', resumeToken: issueResumeToken(username) }));
    ws.send(JSON.stringify({ type: 'init', username, color: ws.userData.color, authenticated: true }));
    if (loadHistory) {
        try {
            const history = await pool.query('SELECT id, username, content, image_url AS "imageUrl", timestamp FROM current_chat ORDER BY timestamp DESC LIMIT $1', [HISTORY_LIMIT]);
            ws.send(JSON.stringify({ type: 'history', content: history.rows.reverse() }));
        } catch (error) { console.error('Error loading history:', error.message); }
    }
    if (!resumed) broadcast(JSON.stringify({ type: 'system', content: `${username} joined the chat.` }));
}

async function saveAndBroadcast(username, color, content, imageUrl = null, imageExpiresAt = null) {
    const timestamp = new Date().toISOString();
    try {
        const result = await pool.query(
            'INSERT INTO current_chat (username, content, image_url, image_expires_at, timestamp) VALUES ($1, $2, $3, $4, $5) RETURNING id',
            [username, content, imageUrl, imageExpiresAt, timestamp]
        );
        broadcast(JSON.stringify({ type: 'message', id: result.rows[0].id, username, color, content, imageUrl, timestamp }));
    } catch (error) { console.error('Error saving message:', error.message); }
}

async function deleteImageFile(imageUrl) {
    const filename = path.basename(imageUrl || '');
    if (!isUploadFilename(filename)) return;
    try { await fs.unlink(path.join(uploadDir, filename)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

async function cleanupExpiredImages() {
    try {
        const [current, archived, files] = await Promise.all([
            pool.query('UPDATE current_chat SET image_url = NULL, image_expires_at = NULL WHERE image_expires_at <= NOW() AND image_url IS NOT NULL RETURNING image_url'),
            pool.query('UPDATE history_archive SET image_url = NULL, image_expires_at = NULL WHERE image_expires_at <= NOW() AND image_url IS NOT NULL RETURNING image_url'),
            fs.readdir(uploadDir, { withFileTypes: true })
        ]);
        await Promise.all([...current.rows, ...archived.rows].map(row => deleteImageFile(row.image_url)));
        const now = Date.now();
        await Promise.all(files.filter(file => file.isFile() && isUploadFilename(file.name)).map(async file => {
            const filePath = path.join(uploadDir, file.name);
            const stat = await fs.stat(filePath);
            if (now - stat.mtimeMs >= IMAGE_LIFETIME_MS) await fs.unlink(filePath);
        }));
        for (const [imageUrl, data] of uploadedImages) if (data.expiresAt <= now) uploadedImages.delete(imageUrl);
    } catch (error) { console.error('Image cleanup failed:', error.message); }
}

function broadcast(data) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client.userData.isLoggedIn) client.send(data);
    });
}

function getRandomColor() {
    return `hsl(${Math.floor(Math.random() * 360)}, 70%, 60%)`;
}

const PORT = process.env.PORT || 3000;

if (require.main === module) {
    Promise.all([initDatabase(), fs.mkdir(uploadDir, { recursive: true })]).then(async () => {
        await cleanupExpiredImages();
        setInterval(() => {
            cleanupExpiredImages();
            removeExpiredTickets();
        }, 60 * 1000).unref();
        server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
    }).catch(error => {
        console.error('Failed to start server:', error);
        process.exit(1);
    });
}

module.exports = { cleanupExpiredImages, deleteImageFile };
