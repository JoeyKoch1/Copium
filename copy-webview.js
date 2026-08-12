const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'src/webview');
const destDir = path.join(__dirname, 'dist/webview');

if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir, { recursive: true });
}

for (const file of fs.readdirSync(srcDir)) {
  fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
}

console.log('Webview files copied to dist/webview/');
