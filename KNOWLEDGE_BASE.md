# TDTU Messenger - Knowledge Base

## Project Overview
Real-time WebSocket chat application built with vanilla JavaScript (single `index.html` file) + Node.js/Express backend.

## File Structure
```
/home/nv/Documents/GitHub/TDTUmes/
├── package.json          # Dependencies: express, ws, pg, bcrypt, @google/generative-ai
├── server.js            # Backend (WebSocket + PostgreSQL)
└── public/
    └── index.html       # All frontend: HTML, CSS, JS in one file
```

## Key Implementation Patterns

### 1. Message Rendering
- `addMessage(type, text, username, color, timestamp)` - Creates DOM elements
- Message types: `user-msg`, `dm-msg`, `system`
- `renderChatMessage(data)` - Called on WebSocket `message` event

### 2. Adding Right-Click Copy Feature
**Location**: Inside `addMessage()` function, after `textSpan` creation

```javascript
// Right-click to copy
contentDiv.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    currentlyCopiedElement = textSpan;
    showContextMenu(e.clientX, e.clientY);
});
```

### 3. Context Menu Implementation
**HTML** (before `</body>`):
```html
<div id="context-menu">
    <div onclick="copyMessageText()">Copy</div>
</div>
```

**CSS** (in `<style>`):
```css
#context-menu {
    display: none;
    position: fixed;
    background: var(--panel-bg);
    border: 1px solid var(--border-color);
    border-radius: 4px;
    z-index: 9999;
    min-width: 120px;
    padding: 4px 0;
    box-shadow: 0 2px 12px rgba(0,0,0,0.6);
}
#context-menu div {
    padding: 8px 16px;
    cursor: pointer;
    color: var(--text-color);
    font-size: 0.9em;
}
#context-menu div:hover {
    background: var(--header-bg);
    color: var(--accent-color);
}
```

**JS** (global functions):
```javascript
let currentlyCopiedElement = null;

function showContextMenu(x, y, callback) {
    const menu = document.getElementById('context-menu');
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.onclick = (e) => {
        e.stopPropagation();
        if (callback) callback();
        hideContextMenu();
    };
    document.addEventListener('click', hideContextMenu);
    menu.style.display = 'block';
}

function hideContextMenu() {
    const menu = document.getElementById('context-menu');
    document.removeEventListener('click', hideContextMenu);
    menu.style.display = 'none';
}

function copyMessageText() {
    if (currentlyCopiedElement && currentlyCopiedElement.textContent) {
        navigator.clipboard.writeText(currentlyCopiedElement.textContent).then(() => {
            showCopyToast();
        }).catch(err => {
            console.error('Failed to copy text: ', err);
        });
    }
}
```

### 4. Toast Notification
**HTML**:
```html
<div id="copy-toast">Copied!</div>
```

**CSS**:
```css
#copy-toast {
    display: none;
    position: fixed;
    bottom: 60px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--accent-color);
    color: #000;
    padding: 10px 24px;
    border-radius: 6px;
    font-weight: bold;
    font-size: 0.9em;
    z-index: 9999;
    opacity: 0;
    transition: opacity 0.3s;
    pointer-events: none;
}
#copy-toast.show {
    display: block;
    opacity: 1;
}
```

**JS**:
```javascript
function showCopyToast() {
    const toast = document.getElementById('copy-toast');
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
    }, 2000);
}
```

## Common Modifications

### Add New Message Feature
1. Find `addMessage()` function (line ~974)
2. Modify DOM creation there
3. Add event listeners on created elements

### Add New Command
1. In `sendMessage()` - check for command prefix
2. Or handle in WebSocket `onmessage` switch on `data.type`

### Add New Tab
1. Add `<button class="tab-btn" data-tab="name">Label</button>` in `<nav id="tab-bar">`
2. Add `<div id="name-panel" class="tab-panel">...</div>` in `#panels-wrapper`
3. Add case in `switchTab(id)`

### Theme Colors
All colors use CSS variables in `:root` - modify for new themes.

## Running the App
```bash
npm start
# Opens at http://localhost:3000 (or configured port)
```

## Database
- Neon PostgreSQL (configured in `server.js`)
- Tables: users, messages
- Uses AES encryption for connection

## WebSocket Protocol
- `type: 'message'` - send chat message
- `type: 'init'` - initial connection data
- `type: 'history'` - message history
- `type: 'dm'` - direct message
- `type: 'theme'` / `'title'` - admin controls

---

*Last updated: 2026-07-28*