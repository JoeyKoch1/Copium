const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'src/webview');
const destDir = path.join(__dirname, 'dist/webview');
const esbuildPath = path.join(__dirname, 'node_modules', '.bin', 'esbuild.cmd');

try {
  console.log('Building extension...');
  const esbuildResult = execSync(`"${esbuildPath}" ./src/extension.ts --bundle --outfile=dist/extension.js --external:vscode --format=cjs --platform=node --target=node18`, {
    cwd: __dirname,
    encoding: 'utf-8',
    shell: true,
  });
  console.log(esbuildResult);

  console.log('Copying webview files...');
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }
  for (const file of fs.readdirSync(srcDir)) {
    fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
  }
  console.log('Build complete!');
} catch (err) {
  console.error('Build failed:', err.message);
  if (err.stdout) console.error('stdout:', err.stdout);
  if (err.stderr) console.error('stderr:', err.stderr);
  process.exit(1);
}
