import type { PluginContext } from '../../../src/plugins/loader';

let turns = 0;

export default function main(ctx: PluginContext): void {
  // A slash command: /wc <file>
  ctx.registerCommand('wc', 'count words in a file', async (arg) => {
    if (!arg.trim()) {
      // In a real plugin you'd render to the UI; for demo purposes we log.
      console.error('usage: /wc <file>');
      return;
    }
    try {
      const text = await Bun.file(arg.trim()).text();
      const words = text.split(/\s+/).filter(Boolean).length;
      console.error(`\n[wordcount] ${arg.trim()}: ${words} words`);
    } catch (err) {
      console.error(`\n[wordcount] failed: ${err instanceof Error ? err.message : err}`);
    }
  });

  // Lifecycle hook demo.
  ctx.on('turn-start', () => {
    turns++;
  });
}
