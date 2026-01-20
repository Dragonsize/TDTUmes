<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TDTU Messenger</title>
    <style>
        :root {
            --bg-color: #1a1a1a;
            --panel-bg: #000;
            --text-color: #ccc;
            --accent-color: #00ff00;
            --header-bg: #2a2a2a;
            --input-bg: #222;
            --border-color: #333;
            --error-color: #ff4444;
            --success-color: #44ff44;
        }

        body.theme-purple { --bg-color: #12001a; --panel-bg: #08000c; --text-color: #c48eff; --accent-color: #9d00ff; --header-bg: #1f002b; --input-bg: #16001f; --border-color: #58008c; }
        body.theme-blue { --bg-color: #051020; --panel-bg: #000510; --text-color: #b0e0ff; --accent-color: #0088ff; --header-bg: #001a36; --input-bg: #001225; --border-color: #003360; }
        body.theme-red { --bg-color: #1a0505; --panel-bg: #0a0000; --text-color: #ffb0b0; --accent-color: #ff0000; --header-bg: #360000; --input-bg: #250000; --border-color: #600000; }

        @keyframes rainbow-anim {
            0% { color: #ff0000; text-shadow: 0 0 5px #ff0000; }
            14% { color: #ff7f00; text-shadow: 0 0 5px #ff7f00; }
            28% { color: #ffff00; text-shadow: 0 0 5px #ffff00; }
            42% { color: #00ff00; text-shadow: 0 0 5px #00ff00; }
            57% { color: #0000ff; text-shadow: 0 0 5px #0000ff; }
            71% { color: #4b0082; text-shadow: 0 0 5px #4b0082; }
            85% { color: #9400d3; text-shadow: 0 0 5px #9400d3; }
            100% { color: #ff0000; text-shadow: 0 0 5px #ff0000; }
        }
        .rainbow-text { animation: rainbow-anim 3s linear infinite; font-weight: bold; }

        body { 
            font-family: 'Courier New', Courier, monospace; 
            background: var(--bg-color); 
            color: var(--text-color);
            margin: 0; 
            padding: 20px; 
            display: flex; 
            flex-direction: column; 
            height: 100vh; 
            box-sizing: border-box; 
            transition: background 0.5s, color 0.5s;
        }

        #login-overlay {
            position: fixed; 
            top: 0; 
            left: 0; 
            width: 100%; 
            height: 100%;
            background: var(--bg-color); 
            z-index: 1000;
            display: flex; 
            flex-direction: column; 
            align-items: center; 
            justify-content: center;
            gap: 20px;
        }

        .login-form {
            background: var(--panel-bg);
            padding: 30px;
            border-radius: 10px;
            border: 2px solid var(--border-color);
            min-width: 350px;
            box-shadow: 0 0 20px rgba(0,255,0,0.1);
        }

        .login-form h2 {
            text-align: center;
            margin-bottom: 20px;
            color: var(--accent-color);
            text-shadow: 0 0 10px var(--accent-color);
        }

        .login-form input {
            width: 100%;
            padding: 12px;
            margin: 10px 0;
            background: var(--input-bg);
            border: 1px solid var(--border-color);
            color: #fff;
            font-family: inherit;
            border-radius: 4px;
            box-sizing: border-box;
            font-size: 0.95em;
        }

        .login-form input:focus {
            outline: none;
            border-color: var(--accent-color);
        }

        .login-form button {
            width: 100%;
            padding: 12px;
            margin: 10px 0;
            background: var(--accent-color);
            color: #000;
            border: none;
            font-weight: bold;
            cursor: pointer;
            border-radius: 4px;
            font-size: 1em;
            transition: opacity 0.3s;
        }

        .login-form button:hover {
            opacity: 0.8;
        }

        .login-form button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .error-msg {
            color: var(--error-color);
            font-size: 0.9em;
            text-align: center;
            margin: 10px 0;
            display: none;
            padding: 8px;
            background: rgba(255, 68, 68, 0.1);
            border-radius: 4px;
        }
        
        header {
            display: flex; 
            gap: 10px; 
            padding-bottom: 15px; 
            border-bottom: 1px solid var(--border-color);
            margin-bottom: 10px; 
            flex-wrap: wrap; 
            align-items: center;
        }

        .setting-group { 
            display: flex; 
            align-items: center; 
            gap: 5px; 
            background: var(--header-bg); 
            padding: 5px 10px; 
            border-radius: 4px; 
        }
        
        label { 
            font-size: 0.8em; 
            color: var(--text-color); 
            opacity: 0.7; 
        }
        
        input[type="text"].settings-input { 
            background: transparent; 
            border: none; 
            color: #fff; 
            border-bottom: 1px solid #555; 
            width: 100px; 
            font-family: inherit; 
        }
        
        #chatTitle { 
            flex: 2; 
            text-align: center; 
            font-weight: bold; 
            font-size: 1.2em; 
            color: var(--accent-color); 
            text-shadow: 0 0 5px rgba(0,0,0,0.5); 
        }
        
        #chat-container { 
            flex: 1; 
            overflow-y: auto; 
            border: 1px solid var(--border-color); 
            padding: 10px; 
            margin-bottom: 10px; 
            background: var(--panel-bg); 
            font-size: 0.9em; 
        }

        .message { 
            margin-bottom: 5px; 
            display: flex; 
            justify-content: space-between; 
        }
        
        .message-content { 
            flex: 1; 
            white-space: pre-wrap; 
            word-break: break-word; 
        }
        
        .system { 
            color: #777; 
            font-style: italic; 
            font-size: 0.85em; 
        }
        
        .dm-msg { 
            color: #ff00ff; 
            border-left: 2px solid #ff00ff; 
            padding-left: 5px; 
        }
        
        .timestamp { 
            color: #666; 
            font-size: 0.75em; 
            margin-left: 10px; 
            white-space: nowrap; 
        }

        #input-area { 
            display: flex; 
            gap: 10px; 
        }
        
        input#messageInput { 
            flex: 1; 
            padding: 12px; 
            background: var(--input-bg); 
            border: 1px solid var(--border-color); 
            color: #fff; 
            font-family: inherit; 
            border-radius: 4px;
        }
        
        input#messageInput:focus {
            outline: none;
            border-color: var(--accent-color);
        }
        
        button { 
            padding: 10px 20px; 
            background: var(--accent-color); 
            color: #000; 
            border: none; 
            font-weight: bold; 
            cursor: pointer; 
            border-radius: 4px; 
        }

        .db-table { 
            width: 100%; 
            border-collapse: collapse; 
            margin-top: 10px; 
            font-size: 0.8em; 
            background: var(--panel-bg);
        }
        
        .db-table th, .db-table td { 
            border: 1px solid var(--border-color); 
            padding: 6px; 
            text-align: left; 
        }
        
        .db-table th { 
            background: var(--header-bg); 
            color: var(--accent-color);
            font-weight: bold;
        }

        .db-table td {
            color: var(--text-color);
        }

        .db-container {
            margin: 10px 0;
            max-height: 300px;
            overflow-y: auto;
        }

        .link-text {
            color: var(--accent-color);
            text-decoration: none;
            cursor: pointer;
        }

        .link-text:hover {
            text-decoration: underline;
        }
    </style>
</head>
<body>

    <div id="login-overlay">
        <div class="login-form">
            <h2>🔐 TDTU MESSENGER</h2>
            
            <div style="text-align: center; color: #888; font-size: 0.9em; margin-bottom: 20px;">
                Secure login required
            </div>

            <!-- Login Form -->
            <div id="loginForm">
                <input type="text" id="loginUsername" placeholder="Username" required autocomplete="username">
                <input type="password" id="loginPassword" placeholder="Password" required autocomplete="current-password">
                <button id="loginBtn" onclick="attemptLogin()">LOGIN</button>
                <div class="error-msg" id="loginError"></div>
                <div style="text-align: center; margin-top: 15px;">
                    <a class="link-text" onclick="showSignup()">Don't have an account? Sign up</a>
                </div>
            </div>

            <!-- Signup Form -->
            <div id="signupForm" style="display: none;">
                <input type="text" id="signupUsername" placeholder="Username (max 20 chars)" maxlength="20" required autocomplete="username">
                <input type="password" id="signupPassword" placeholder="Password (min 4 chars)" required autocomplete="new-password">
                <input type="password" id="signupConfirmPassword" placeholder="Confirm Password" required autocomplete="new-password">
                <button id="signupBtn" onclick="attemptSignup()">CREATE ACCOUNT</button>
                <div class="error-msg" id="signupError"></div>
                <div style="text-align: center; margin-top: 15px;">
                    <a class="link-text" onclick="showLogin()">Back to Login</a>
                </div>
            </div>
        </div>
    </div>

    <header>
        <div class="setting-group">
            <label>NAME:</label>
            <input type="text" id="usernameInput" class="settings-input" disabled>
        </div>
        <div class="setting-group">
            <label>COLOR:</label>
            <input type="color" id="colorInput" value="#00ff00" disabled>
        </div>
        <div id="chatTitle">Classroom</div>
        <div style="flex:1; text-align: right; font-size: 0.8em;">
            STATUS: <span id="status" style="color: var(--error-color);">Connecting...</span>
        </div>
    </header>

    <div id="chat-container"></div>

    <div id="input-area" style="display: none;">
        <input type="text" id="messageInput" placeholder="Type /? for commands..." autofocus>
        <button onclick="sendMessage()">SEND</button>
    </div>

    <script>
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = protocol + '//' + window.location.host;
        let ws = null;
        let reconnectAttempts = 0;
        let maxReconnectAttempts = 5;
        
        const chatContainer = document.getElementById('chat-container');
        const messageInput = document.getElementById('messageInput');
        const usernameInput = document.getElementById('usernameInput');
        const colorInput = document.getElementById('colorInput');
        const statusSpan = document.getElementById('status');
        const chatTitle = document.getElementById('chatTitle');
        const loginOverlay = document.getElementById('login-overlay');
        const inputArea = document.getElementById('input-area');

        let isAdmin = false;
        let isAuthenticated = false;
        let pendingAuthCommand = null;

        function showSignup() {
            document.getElementById('loginForm').style.display = 'none';
            document.getElementById('signupForm').style.display = 'block';
            document.getElementById('loginError').style.display = 'none';
            document.getElementById('signupError').style.display = 'none';
            document.getElementById('signupUsername').value = '';
            document.getElementById('signupPassword').value = '';
            document.getElementById('signupConfirmPassword').value = '';
            document.getElementById('signupUsername').focus();
        }

        function showLogin() {
            document.getElementById('signupForm').style.display = 'none';
            document.getElementById('loginForm').style.display = 'block';
            document.getElementById('loginError').style.display = 'none';
            document.getElementById('signupError').style.display = 'none';
            document.getElementById('loginUsername').value = '';
            document.getElementById('loginPassword').value = '';
            document.getElementById('loginUsername').focus();
        }

        function attemptLogin() {
            const username = document.getElementById('loginUsername').value.trim();
            const password = document.getElementById('loginPassword').value;
            
            if (!username || !password) {
                showError('loginError', 'Please fill in all fields');
                return;
            }

            document.getElementById('loginBtn').disabled = true;
            document.getElementById('loginError').style.display = 'none';

            const command = `/login ${username} ${password}`;
            
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'message', content: command }));
            } else {
                pendingAuthCommand = command;
                connectWebSocket();
            }
        }

        function attemptSignup() {
            const username = document.getElementById('signupUsername').value.trim();
            const password = document.getElementById('signupPassword').value;
            const confirmPassword = document.getElementById('signupConfirmPassword').value;
            
            if (!username || !password || !confirmPassword) {
                showError('signupError', 'Please fill in all fields');
                return;
            }
            
            if (password !== confirmPassword) {
                showError('signupError', 'Passwords do not match');
                return;
            }
            
            if (password.length < 4) {
                showError('signupError', 'Password must be at least 4 characters');
                return;
            }

            if (username.length > 20) {
                showError('signupError', 'Username must be 20 characters or less');
                return;
            }

            document.getElementById('signupBtn').disabled = true;
            document.getElementById('signupError').style.display = 'none';

            const command = `/register ${username} ${password}`;
            
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'message', content: command }));
            } else {
                pendingAuthCommand = command;
                connectWebSocket();
            }
        }

        function showError(elementId, message) {
            const errorEl = document.getElementById(elementId);
            errorEl.textContent = message;
            errorEl.style.display = 'block';
            
            // Re-enable buttons
            document.getElementById('loginBtn').disabled = false;
            document.getElementById('signupBtn').disabled = false;
        }

        function connectWebSocket() {
            if (ws && ws.readyState === WebSocket.OPEN) return;

            ws = new WebSocket(wsUrl);
            
            ws.onopen = () => {
                console.log('✅ WebSocket connected');
                statusSpan.textContent = 'Connected';
                statusSpan.style.color = 'var(--success-color)';
                reconnectAttempts = 0;

                // Send pending auth command if exists
                if (pendingAuthCommand) {
                    ws.send(JSON.stringify({ type: 'message', content: pendingAuthCommand }));
                    pendingAuthCommand = null;
                }
            };

            ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                
                switch(data.type) {
                    case 'init':
                        usernameInput.value = data.username;
                        colorInput.value = data.color;
                        isAuthenticated = data.authenticated;
                        if (isAuthenticated) {
                            handleAuthSuccess();
                        }
                        break;

                    case 'auth_success':
                        handleAuthSuccess();
                        break;

                    case 'auth_error':
                        showError(data.form === 'login' ? 'loginError' : 'signupError', data.message);
                        break;

                    case 'system':
                        addMessage('system', data.content);
                        break;

                    case 'message':
                        renderChatMessage(data);
                        break;

                    case 'history':
                        data.content.forEach(msg => renderChatMessage(msg));
                        addMessage('system', '--- End of History ---');
                        break;

                    case 'theme':
                        applyTheme(data.theme);
                        break;

                    case 'title':
                        chatTitle.textContent = data.title;
                        break;

                    case 'admin_granted':
                        isAdmin = true;
                        break;

                    case 'clear_history':
                        chatContainer.innerHTML = '';
                        break;

                    case 'database_view':
                        renderDatabaseTable(data.data);
                        break;

                    case 'pong':
                        const latency = Date.now() - data.startTime;
                        addMessage('system', `🏓 Pong! Latency: ${latency}ms`);
                        break;

                    case 'dm':
                        const dmMsg = data.from === usernameInput.value 
                            ? `[DM to ${data.to}] ${data.content}`
                            : `[DM from ${data.from}] ${data.content}`;
                        addMessage('dm', dmMsg, null, data.color);
                        break;
                }
            };

            ws.onclose = () => {
                console.log('❌ WebSocket disconnected');
                statusSpan.textContent = 'Disconnected';
                statusSpan.style.color = 'var(--error-color)';
                
                if (isAuthenticated) {
                    addMessage('system', '❌ Connection lost. Reconnecting...');
                    attemptReconnect();
                }
            };

            ws.onerror = (error) => {
                console.error('WebSocket error:', error);
            };
        }

        function handleAuthSuccess() {
            loginOverlay.style.display = 'none';
            inputArea.style.display = 'flex';
            usernameInput.disabled = true;
            colorInput.disabled = false;
            isAuthenticated = true;
            statusSpan.textContent = 'Authenticated';
            statusSpan.style.color = 'var(--success-color)';
            messageInput.focus();
            
            // Re-enable buttons for potential future use
            document.getElementById('loginBtn').disabled = false;
            document.getElementById('signupBtn').disabled = false;
        }

        function attemptReconnect() {
            if (reconnectAttempts < maxReconnectAttempts) {
                reconnectAttempts++;
                setTimeout(() => {
                    console.log(`Reconnecting... (${reconnectAttempts}/${maxReconnectAttempts})`);
                    connectWebSocket();
                }, 2000 * reconnectAttempts);
            } else {
                addMessage('system', '❌ Failed to reconnect. Please refresh the page.');
            }
        }

        function sendMessage() {
            const text = messageInput.value.trim();
            if (!text || !isAuthenticated || !ws || ws.readyState !== WebSocket.OPEN) return;
            
            if (text.toLowerCase() === '/cls' || text.toLowerCase() === '/clear') {
                chatContainer.innerHTML = '';
                messageInput.value = '';
                return;
            }
            
            ws.send(JSON.stringify({ type: 'message', content: text }));
            messageInput.value = '';
        }

        function renderChatMessage(data) {
            const time = new Date(data.timestamp).toLocaleTimeString();
            addMessage('user', data.content, data.username, data.color, time);
        }

        function addMessage(type, text, username = null, color = null, timestamp = null) {
            const div = document.createElement('div');
            div.className = `message ${type === 'system' ? 'system' : (type === 'dm' ? 'dm-msg' : 'user-msg')}`;

            const contentDiv = document.createElement('div');
            contentDiv.className = 'message-content';

            if (username) {
                const nameSpan = document.createElement('span');
                if (color === 'rainbow') {
                    nameSpan.className = 'rainbow-text';
                } else {
                    nameSpan.style.color = color || 'var(--accent-color)';
                }
                nameSpan.style.fontWeight = 'bold';
                nameSpan.textContent = `[${username}] `;
                contentDiv.appendChild(nameSpan);
            }

            const textSpan = document.createElement('span');
            textSpan.textContent = text;
            contentDiv.appendChild(textSpan);
            div.appendChild(contentDiv);

            if (timestamp) {
                const timeSpan = document.createElement('span');
                timeSpan.className = 'timestamp';
                timeSpan.textContent = timestamp;
                div.appendChild(timeSpan);
            }

            chatContainer.appendChild(div);
            chatContainer.scrollTop = chatContainer.scrollHeight;
        }

        function applyTheme(theme) {
            document.body.className = theme !== 'default' ? `theme-${theme}` : '';
        }

        function renderDatabaseTable(rows) {
            const container = document.createElement('div');
            container.className = 'db-container';
            
            let html = '<table class="db-table"><thead><tr><th>ID</th><th>Username</th><th>Content</th><th>Timestamp</th></tr></thead><tbody>';
            
            rows.forEach(row => {
                const time = new Date(row.timestamp).toLocaleString();
                const content = row.content.length > 50 ? row.content.substring(0, 50) + '...' : row.content;
                html += `<tr>
                    <td>${row.id}</td>
                    <td>${row.username}</td>
                    <td>${content}</td>
                    <td>${time}</td>
                </tr>`;
            });
            
            html += '</tbody></table>';
            container.innerHTML = '<div class="system" style="font-weight: bold; margin-bottom: 5px;">📊 Database View (Last 100 messages):</div>' + html;
            
            chatContainer.appendChild(container);
            chatContainer.scrollTop = chatContainer.scrollHeight;
        }

        messageInput.addEventListener('keypress', (e) => { 
            if (e.key === 'Enter') sendMessage(); 
        });

        colorInput.addEventListener('change', () => {
            if (ws && isAuthenticated && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'update_color', content: colorInput.value }));
            }
        });

        // Support Enter key for login/signup
        document.getElementById('loginPassword').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') attemptLogin();
        });

        document.getElementById('signupConfirmPassword').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') attemptSignup();
        });

        // Initialize connection
        connectWebSocket();
    </script>
</body>
</html>
