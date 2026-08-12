const vscode = acquireVsCodeApi();
const messagesDiv = document.getElementById('messages');
const input = document.getElementById('input');
const sendBtn = document.getElementById('sendBtn');
const clearBtn = document.getElementById('clearBtn');
const tabs = document.querySelectorAll('.tab');
const tabContents = document.querySelectorAll('.tab-content');
const statusIndicator = document.getElementById('statusIndicator');
const statusText = document.getElementById('statusText');
const statusIcons = document.getElementById('statusIcons');

let currentAssistantDiv = null;
let sessionStartTime = Date.now();
let tokenCount = 0;
let toolCount = 0;
let messageCount = 0;
let tokenHistory = [];
let activityLog = [];
let pendingUserText = '';
let responseTimeout = null;
let isProcessing = false;
let thinkingDiv = null;
let activeAgents = new Set();
let currentToolName = '';

function switchTab(tabId) {
  tabs.forEach(function(t) { t.classList.toggle('active', t.dataset.tab === tabId); });
  tabContents.forEach(function(c) { c.classList.toggle('hidden', c.id !== 'tab-' + tabId); });
}

tabs.forEach(function(tab) {
  tab.addEventListener('click', function() { switchTab(tab.dataset.tab); });
});

function setStatus(state, text) {
  if (!statusIndicator || !statusText) return;
  statusIndicator.className = 'status-indicator ' + state;
  statusText.textContent = text;
}

function addAgentBadge(agentId, agentName) {
  if (!statusIcons) return;
  if (activeAgents.has(agentId)) return;
  activeAgents.add(agentId);
  const badge = document.createElement('span');
  badge.className = 'swarm-agent-badge active';
  badge.id = 'agent-' + agentId;
  badge.textContent = agentName || agentId;
  statusIcons.appendChild(badge);
}

function removeAgentBadge(agentId) {
  if (!statusIcons) return;
  activeAgents.delete(agentId);
  const badge = document.getElementById('agent-' + agentId);
  if (badge) badge.remove();
}

function clearAgentBadges() {
  if (!statusIcons) return;
  activeAgents.clear();
  statusIcons.innerHTML = '';
}

function formatTime(ms) {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return minutes + 'm ' + seconds + 's';
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function renderMarkdown(text) {
  let html = text;

  const codeBlocks = [];
  html = html.replace(/```([\s\S]*?)```/g, function(_, code) {
    codeBlocks.push(code.replace(/^\n+|\n+$/g, ''));
    return '\n```CODEBLOCK_' + (codeBlocks.length - 1) + '```\n';
  });

  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  html = html.replace(/^#{1,6}\s+(.+)$/gm, function(_, title) {
    const level = _.charAt(0) === '#' ? _.indexOf(' ') : 2;
    const tag = 'h' + Math.min(level + 1, 6);
    return '<' + tag + '>' + title + '</' + tag + '>';
  });

  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
  html = html.replace(/_(.+?)_/g, '<em>$1</em>');

  const listItems = [];
  html = html.replace(/^[ \t]*[-*+]\s+(.+)$/gm, function(_, item) {
    listItems.push('<li>' + item + '</li>');
    return '';
  });
  html = html.replace(/^[ \t]*\d+\.\s+(.+)$/gm, function(_, item) {
    listItems.push('<li>' + item + '</li>');
    return '';
  });
  if (listItems.length > 0) {
    html = html + '<ul>' + listItems.join('') + '</ul>';
  }

  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  html = html.replace(/```CODEBLOCK_(\d+)```/g, function(_, idx) {
    return '<pre><code>' + codeBlocks[idx] + '</code></pre>';
  });

  const lines = html.split('\n');
  const processed = [];
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === '---' || trimmed === '***' || trimmed === '___') {
      processed.push('<hr>');
    } else if (trimmed.startsWith('> ')) {
      processed.push('<blockquote>' + trimmed.slice(2) + '</blockquote>');
    } else if (trimmed === '') {
      processed.push('<br>');
    } else {
      processed.push(lines[i]);
    }
  }
  html = processed.join('\n');

  return html;
}

function updateDashboard() {
  const elapsed = Date.now() - sessionStartTime;
  const statMessages = document.getElementById('statMessages');
  const statTokens = document.getElementById('statTokens');
  const statTools = document.getElementById('statTools');
  const statTime = document.getElementById('statTime');

  if (statMessages) statMessages.textContent = String(messageCount);
  if (statTokens) statTokens.textContent = String(tokenCount);
  if (statTools) statTools.textContent = String(toolCount);
  if (statTime) statTime.textContent = formatTime(elapsed);

  const chart = document.getElementById('tokenChart');
  if (chart && tokenHistory.length > 0) {
    const max = Math.max.apply(null, tokenHistory);
    const points = tokenHistory.map(function(v, i) {
      const x = (i / Math.max(tokenHistory.length - 1, 1)) * 100;
      const y = 100 - (v / max) * 100;
      return x + ',' + y;
    }).join(' ');
    chart.innerHTML = '<svg viewBox="0 0 100 100" preserveAspectRatio="none" style="width:100%;height:100%"><polyline points="' + points + '" fill="none" stroke="var(--vscode-textLink-foreground)" stroke-width="2"/></svg>';
  }

  const log = document.getElementById('activityLog');
  if (log) {
    log.innerHTML = activityLog.slice(-10).reverse().map(function(a) {
      return '<div class="activity-item"><span class="activity-time">' + a.time + '</span><span>' + a.text + '</span></div>';
    }).join('');
  }
}

function addActivity(text) {
  const now = new Date();
  activityLog.push({ time: now.toLocaleTimeString(), text: text });
  updateDashboard();
}

function appendMessage(role, text) {
  const div = document.createElement('div');
  div.className = 'message ' + role;
  if (role === 'assistant' || role === 'tool') {
    div.innerHTML = renderMarkdown(text);
  } else {
    div.textContent = text;
  }
  messagesDiv.appendChild(div);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
  return div;
}

function appendToolResult(name, text) {
  currentToolName = name;
  const div = document.createElement('div');
  div.className = 'message tool';
  div.innerHTML = '<strong>[' + name + ']</strong> ' + renderMarkdown(text);
  messagesDiv.appendChild(div);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function showThinking(label) {
  if (thinkingDiv) return;
  thinkingDiv = document.createElement('div');
  thinkingDiv.className = 'message assistant thinking';
  const labelText = label ? label + ' is thinking' : 'Copium is thinking';
  thinkingDiv.innerHTML = '<span class="thinking-label">' + labelText + '</span> <span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span>';
  messagesDiv.appendChild(thinkingDiv);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function hideThinking() {
  if (thinkingDiv) {
    thinkingDiv.remove();
    thinkingDiv = null;
  }
}

function startResponseWatchdog() {
  if (responseTimeout) clearTimeout(responseTimeout);
  responseTimeout = setTimeout(function() {
    if (pendingUserText) {
      hideLoading();
      hideThinking();
      appendMessage('error', 'Request timed out. The extension may not be activated.');
      pendingUserText = '';
      isProcessing = false;
      setStatus('error', 'Timed out');
    }
  }, 20000);
}

function stopResponseWatchdog() {
  if (responseTimeout) {
    clearTimeout(responseTimeout);
    responseTimeout = null;
  }
}

function showLoading() {
  sendBtn.disabled = true;
  sendBtn.classList.add('loading');
  setStatus('thinking', 'Thinking...');
  startResponseWatchdog();
}

function hideLoading() {
  sendBtn.disabled = false;
  sendBtn.classList.remove('loading');
  hideThinking();
  stopResponseWatchdog();
  setStatus('ready', 'Ready');
}

function sendMessage(text) {
  if (!text || isProcessing) return;
  isProcessing = true;
  pendingUserText = text;
  appendMessage('user', text);
  addActivity('You: ' + text);

  try {
    vscode.postMessage({ command: 'sendMessage', text: text });
  } catch (err) {
    appendMessage('error', 'Failed to send message: ' + (err.message || err));
    isProcessing = false;
    pendingUserText = '';
    hideLoading();
    setStatus('error', 'Send failed');
    return;
  }

  showLoading();
}

sendBtn.addEventListener('click', function() {
  const text = input.value.trim();
  input.value = '';
  currentAssistantDiv = null;
  messageCount++;
  sendMessage(text);
});

input.addEventListener('keydown', function(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    const text = input.value.trim();
    input.value = '';
    currentAssistantDiv = null;
    messageCount++;
    sendMessage(text);
  }
});

clearBtn.addEventListener('click', function() {
  vscode.postMessage({ command: 'clearHistory' });
});

document.getElementById('saveSettings').addEventListener('click', function() {
  const provider = document.getElementById('settingProvider').value || 'openrouter';
  const model = document.getElementById('settingModel').value || 'openrouter/free';
  const permission = document.getElementById('settingPermission').value || 'propose-edits';
  const swarmEnabled = document.getElementById('settingSwarm').checked || false;
  const maxAgents = parseInt(document.getElementById('settingMaxAgents').value || '3', 10);

  vscode.postMessage({ command: 'saveSettings', settings: { provider: provider, model: model, permission: permission, swarmEnabled: swarmEnabled, maxAgents: maxAgents } });
});

window.addEventListener('message', function(event) {
  const data = event.data;
  switch (data.type) {
    case 'userMessage':
      pendingUserText = '';
      stopResponseWatchdog();
      hideLoading();
      isProcessing = false;
      break;
    case 'token':
      pendingUserText = '';
      stopResponseWatchdog();
      hideLoading();
      isProcessing = false;
      if (!currentAssistantDiv) {
        currentAssistantDiv = document.createElement('div');
        currentAssistantDiv.className = 'message assistant';
        messagesDiv.appendChild(currentAssistantDiv);
      }
      currentAssistantDiv.innerHTML = renderMarkdown(currentAssistantDiv.textContent + data.text);
      tokenCount = data.tokenCount || tokenCount;
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
      updateDashboard();
      break;
    case 'status':
      setStatus(data.state || 'thinking', data.text || 'Processing...');
      break;
    case 'assistant':
      hideThinking();
      appendMessage('assistant', data.text);
      addActivity('Assistant: ' + (data.text || '').slice(0, 50));
      break;
    case 'toolResult':
      toolCount = data.toolCount || toolCount;
      appendToolResult(data.name, data.text);
      addActivity('Tool: ' + data.name);
      setStatus('tool', 'Using tool: ' + (currentToolName || data.name));
      break;
    case 'error':
      pendingUserText = '';
      stopResponseWatchdog();
      hideLoading();
      isProcessing = false;
      appendMessage('error', 'Error: ' + data.text);
      addActivity('Error: ' + data.text);
      setStatus('error', 'Error');
      break;
    case 'done':
      pendingUserText = '';
      stopResponseWatchdog();
      hideLoading();
      isProcessing = false;
      currentAssistantDiv = null;
      updateDashboard();
      break;
    case 'thinking':
      showThinking(data.label);
      setStatus('thinking', data.label ? data.label + ' is thinking' : 'Thinking...');
      break;
    case 'swarmStart':
      clearAgentBadges();
      if (data.agents && Array.isArray(data.agents)) {
        data.agents.forEach(function(agent) {
          addAgentBadge(agent.id, agent.name);
        });
      }
      setStatus('swarm', 'Swarm active: ' + (data.agents ? data.agents.length : 0) + ' agents');
      appendMessage('system', 'Swarm started with ' + (data.agents ? data.agents.length : 0) + ' agents');
      break;
    case 'swarmEnd':
      clearAgentBadges();
      setStatus('ready', 'Swarm complete');
      break;
    case 'swarmAgentUpdate':
      if (data.agentId && data.status) {
        setStatus('thinking', data.agentId + ': ' + data.status);
      }
      break;
    case 'cleared':
      pendingUserText = '';
      stopResponseWatchdog();
      hideLoading();
      isProcessing = false;
      tokenCount = data.tokenCount || 0;
      toolCount = data.toolCount || 0;
      messageCount = data.messageCount || 0;
      tokenHistory = [];
      activityLog = [];
      messagesDiv.innerHTML = '';
      currentAssistantDiv = null;
      clearAgentBadges();
      updateDashboard();
      setStatus('ready', 'Ready');
      break;
    case 'stats':
      tokenCount = data.tokenCount || tokenCount;
      toolCount = data.toolCount || toolCount;
      messageCount = data.messageCount || messageCount;
      if (data.tokenHistory) tokenHistory = data.tokenHistory;
      updateDashboard();
      break;
    case 'settings':
      const providerEl = document.getElementById('settingProvider');
      const modelEl = document.getElementById('settingModel');
      const permissionEl = document.getElementById('settingPermission');
      const swarmEl = document.getElementById('settingSwarm');
      const agentsEl = document.getElementById('settingMaxAgents');
      if (providerEl) providerEl.value = data.provider || 'openrouter';
      if (modelEl) modelEl.value = data.model || 'openrouter/free';
      if (permissionEl) permissionEl.value = data.permission || 'propose-edits';
      if (swarmEl) swarmEl.checked = data.swarmEnabled || false;
      if (agentsEl) agentsEl.value = String(data.maxAgents || 3);
      break;
    case 'settingsSaved':
      vscode.postMessage({ command: 'getSettings' });
      appendMessage('system', 'Settings saved successfully');
      break;
    case 'settingsChanged':
      vscode.postMessage({ command: 'getSettings' });
      break;
  }
});

vscode.postMessage({ command: 'getStats' });
vscode.postMessage({ command: 'getSettings' });
updateDashboard();
setInterval(updateDashboard, 30000);
