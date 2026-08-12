const messagesDiv = document.getElementById('messages');
const input = document.getElementById('input');
const sendBtn = document.getElementById('sendBtn');
const clearBtn = document.getElementById('clearBtn');

function appendMessage(role, text) {
  const div = document.createElement('div');
  div.className = 'message ' + role;
  div.textContent = text;
  messagesDiv.appendChild(div);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

function appendToolResult(name, text) {
  const div = document.createElement('div');
  div.className = 'message tool';
  div.innerHTML = '<strong>[' + name + ']</strong> ' + text;
  messagesDiv.appendChild(div);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

sendBtn.addEventListener('click', () => {
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  vscode.postMessage({ command: 'sendMessage', text });
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
      appendMessage('user', data.text);
      break;
    case 'token':
      appendMessage('assistant', data.text);
      break;
    case 'toolResult':
      appendToolResult(data.name, data.text);
      break;
    case 'error':
      appendMessage('error', 'Error: ' + data.text);
      break;
    case 'cleared':
      messagesDiv.innerHTML = '';
      break;
  }
});
