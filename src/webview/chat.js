const messagesDiv = document.getElementById('messages');
const input = document.getElementById('input');
const sendBtn = document.getElementById('sendBtn');
const clearBtn = document.getElementById('clearBtn');
const loadingDiv = document.getElementById('loading');

let currentAssistantDiv = null;

function appendMessage(role, text) {
  const div = document.createElement('div');
  div.className = 'message ' + role;
  div.textContent = text;
  messagesDiv.appendChild(div);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
  return div;
}

function appendToolResult(name, text) {
  const div = document.createElement('div');
  div.className = 'message tool';
  div.innerHTML = '<strong>[' + name + ']</strong> ' + text;
  messagesDiv.appendChild(div);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function showLoading() {
  if (loadingDiv) {
    loadingDiv.classList.add('active');
  }
  if (sendBtn) sendBtn.disabled = true;
}

function hideLoading() {
  if (loadingDiv) {
    loadingDiv.classList.remove('active');
  }
  if (sendBtn) sendBtn.disabled = false;
}

sendBtn.addEventListener('click', () => {
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  currentAssistantDiv = null;
  vscode.postMessage({ command: 'sendMessage', text });
  showLoading();
});

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendBtn.click();
  }
});

clearBtn.addEventListener('click', () => {
  vscode.postMessage({ command: 'clearHistory' });
});

window.addEventListener('message', (event) => {
  const data = event.data;
  switch (data.type) {
    case 'userMessage':
      hideLoading();
      appendMessage('user', data.text);
      break;
    case 'token':
      hideLoading();
      if (!currentAssistantDiv) {
        currentAssistantDiv = document.createElement('div');
        currentAssistantDiv.className = 'message assistant';
        messagesDiv.appendChild(currentAssistantDiv);
      }
      currentAssistantDiv.textContent += data.text;
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
      break;
    case 'toolResult':
      appendToolResult(data.name, data.text);
      break;
    case 'error':
      hideLoading();
      appendMessage('error', 'Error: ' + data.text);
      break;
    case 'done':
      hideLoading();
      currentAssistantDiv = null;
      break;
    case 'cleared':
      hideLoading();
      messagesDiv.innerHTML = '';
      currentAssistantDiv = null;
      break;
  }
});
