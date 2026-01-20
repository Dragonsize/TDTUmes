const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Neon Database Connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Initialize database - tables already exist in Neon, just verify connection
async function initDatabase() {
    try {
        // Test database connection
        const result = await pool.query('SELECT NOW()');
        console.log('✅ Database connected successfully');
        console.log('✅ Server time:', result.rows[0].now);
        
        // Verify tables exist
        const tablesCheck = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name IN ('users', 'current_chat')
        `);
        
        console.log('✅ Found tables:', tablesCheck.rows.map(r => r.table_name).join(', '));
        
    } catch (err) {
        console.error('❌ Database connection error:', err);
        process.exit(1);
    }
}

app.use(express.static(path.join(__dirname, 'public')));

const HISTORY_LIMIT = 50;
let currentTheme = 'default';
let currentTitle = 'Classroom';

wss.on('connection', async (ws, req) => {
    let ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    ws.userData = { 
        username: '', 
        color: '#00ff00', 
        ip, 
        isAdmin: false, 
        isLoggedIn: false 
    };

    console.log(`🔌 New connection from ${ip}`);

    // Initial state sync
    ws.send(JSON.stringify({ type: 'theme', theme: currentTheme }));
    ws.send(JSON.stringify({ type: 'title', title: currentTitle }));
    ws.send(JSON.stringify({ type: 'system', content: '🔐 Welcome! Please login or register.' }));

    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message.toString());
            
            if (data.type === 'message') {
                const content = data.content.trim();
                
                if (content.startsWith('/')) {
                    await handleCommand(ws, content);
                } else if (ws.userData.isLoggedIn) {
                    await saveAndBroadcast(ws.userData.username, ws.userData.color, content);
                } else {
                    ws.send(JSON.stringify({ 
                        type: 'system', 
                        content: '❌ Please login first.' 
                    }));
                }
            } else if (data.type === 'update_color' && ws.userData.isLoggedIn) {
                ws.userData.color = data.content;
            } else if (data.type === 'update_name' && ws.userData.isLoggedIn) {
                // Prevent username changes after login for security
                ws.send(JSON.stringify({ 
                    type: 'system', 
                    content: '⚠️ Cannot change username while logged in.' 
                }));
            }
        } catch (e) {
            console.error('WS Error:', e);
            ws.send(JSON.stringify({ 
                type: 'system', 
                content: '❌ Invalid message format' 
            }));
        }
    });

    ws.on('close', () => {
        if (ws.userData.isLoggedIn) {
            console.log(`👋 ${ws.userData.username} disconnected`);
            broadcast(JSON.stringify({ 
                type: 'system', 
                content: `${ws.userData.username} left.` 
            }));
        }
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

async function handleCommand(ws, content) {
    const parts = content.split(' ');
    const cmd = parts[0].toLowerCase();
    
    // REGISTRATION
    if (cmd === '/register') {
        const username = parts[1]?.trim();
        const password = parts.slice(2).join(' '); // Support passwords with spaces
        
        if (!username || !password) {
            ws.send(JSON.stringify({ 
                type: 'auth_error', 
                form: 'signup',
                message: '❌ Usage: /register <username> <password>' 
            }));
            return;
        }

        if (username.length > 20) {
            ws.send(JSON.stringify({ 
                type: 'auth_error', 
                form: 'signup',
                message: '❌ Username must be 20 characters or less' 
            }));
            return;
        }

        if (password.length < 4) {
            ws.send(JSON.stringify({ 
                type: 'auth_error', 
                form: 'signup',
                message: '❌ Password must be at least 4 characters' 
            }));
            return;
        }

        try {
            // Check if username exists
            const check = await pool.query(
                'SELECT username FROM users WHERE username = $1', 
                [username]
            );
            
            if (check.rows.length > 0) {
                ws.send(JSON.stringify({ 
                    type: 'auth_error', 
                    form: 'signup',
                    message: '❌ Username already taken' 
                }));
                return;
            }

            // Hash password and create user
            const hash = await bcrypt.hash(password, 10);
            await pool.query(
                'INSERT INTO users (username, password_hash, personal_note) VALUES ($1, $2, $3)', 
                [username, hash, '']
            );

            console.log(`✅ New user registered: ${username}`);

            // Auto-login after registration
            await loginUser(ws, username);

        } catch (e) {
            console.error('Registration error:', e);
            ws.send(JSON.stringify({ 
                type: 'auth_error', 
                form: 'signup',
                message: '❌ Registration failed. Please try again.' 
            }));
        }
        return;
    }

    // LOGIN
    if (cmd === '/login') {
        const username = parts[1]?.trim();
        const password = parts.slice(2).join(' '); // Support passwords with spaces
        
        if (!username || !password) {
            ws.send(JSON.stringify({ 
                type: 'auth_error', 
                form: 'login',
                message: '❌ Usage: /login <username> <password>' 
            }));
            return;
        }

        try {
            // Get user from database
            const userRes = await pool.query(
                'SELECT username, password_hash FROM users WHERE username = $1', 
                [username]
            );

            if (userRes.rows.length === 0) {
                ws.send(JSON.stringify({ 
                    type: 'auth_error', 
                    form: 'login',
                    message: '❌ Invalid username or password' 
                }));
                return;
            }

            const user = userRes.rows[0];

            // Verify password
            const validPassword = await bcrypt.compare(password, user.password_hash);
            
            if (!validPassword) {
                ws.send(JSON.stringify({ 
                    type: 'auth_error', 
                    form: 'login',
                    message: '❌ Invalid username or password' 
                }));
                return;
            }

            console.log(`✅ User logged in: ${username}`);

            // Login successful
            await loginUser(ws, username);

        } catch (e) {
            console.error('Login error:', e);
            ws.send(JSON.stringify({ 
                type: 'auth_error', 
                form: 'login',
                message: '❌ Login failed. Please try again.' 
            }));
        }
        return;
    }

    // Commands that require login
    if (!ws.userData.isLoggedIn) {
        ws.send(JSON.stringify({ 
            type: 'system', 
            content: '❌ Please login first.' 
        }));
        return;
    }
    
    // ADMIN ACCESS
    if (cmd === '/admin@') {
        ws.userData.isAdmin = true;
        ws.send(JSON.stringify({ type: 'admin_granted' }));
        ws.send(JSON.stringify({ 
            type: 'system', 
            content: '🔐 Admin access granted.' 
        }));
    } 
    // CLEAR SCREEN
    else if (cmd === '/cls' || cmd === '/clear') {
        ws.send(JSON.stringify({ type: 'clear_history' }));
    }
    // HELP
    else if (cmd === '/?') {
        const helpText = `
Available Commands:
/login <user> <pass> - Login to account
/register <user> <pass> - Create new account
/cls - Clear screen
/? - Show this help
        `.trim();
        ws.send(JSON.stringify({ 
            type: 'system', 
            content: helpText 
        }));
    }
}

async function loginUser(ws, username) {
    ws.userData.username = username;
    ws.userData.isLoggedIn = true;
    ws.userData.color = getRandomColor();

    // Send auth success
    ws.send(JSON.stringify({ 
        type: 'auth_success', 
        message: '🔓 Login successful!' 
    }));

    // Send init data
    ws.send(JSON.stringify({ 
        type: 'init', 
        username, 
        color: ws.userData.color, 
        authenticated: true 
    }));

    // Load chat history
    try {
        const history = await pool.query(
            'SELECT username, content, timestamp FROM current_chat ORDER BY timestamp ASC LIMIT $1', 
            [HISTORY_LIMIT]
        );
        
        ws.send(JSON.stringify({ 
            type: 'history', 
            content: history.rows 
        }));
    } catch (e) {
        console.error('Error loading history:', e);
    }

    // Broadcast join message
    broadcast(JSON.stringify({ 
        type: 'system', 
        content: `✅ ${username} joined the chat.` 
    }));
}

async function saveAndBroadcast(username, color, content) {
    const timestamp = new Date().toISOString();
    
    try {
        await pool.query(
            'INSERT INTO current_chat (username, content, timestamp) VALUES ($1, $2, $3)', 
            [username, content, timestamp]
        );
        
        broadcast(JSON.stringify({ 
            type: 'message', 
            username, 
            color, 
            content, 
            timestamp 
        }));
    } catch (e) {
        console.error('Error saving message:', e);
    }
}

function broadcast(data) {
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN && client.userData.isLoggedIn) {
            client.send(data);
        }
    });
}

function getRandomColor() {
    return `hsl(${Math.floor(Math.random() * 360)}, 70%, 60%)`;
}

const PORT = process.env.PORT || 3000;

initDatabase().then(() => {
    server.listen(PORT, () => {
        console.log(`🚀 Server running on port ${PORT}`);
        console.log(`📊 Database connected to Neon`);
    });
}).catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
});
