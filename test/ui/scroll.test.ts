import { describe, it, expect, afterAll } from 'bun:test';
import { createTestRenderer } from '@opentui/core/testing';
import { BoxRenderable, ScrollBoxRenderable, TextRenderable, TextareaRenderable } from '@opentui/core';
import { buildSyntaxStyle, DARK_THEME } from '../../src/ui/theme';

describe('message scroll (layout regression)', () => {
  it('keeps horizontal offset at 0 when pinning to the bottom after new content', async () => {
    const syntaxStyle = buildSyntaxStyle(DARK_THEME);
    const { renderer, flush } = await createTestRenderer({ width: 80, height: 20 });

    try {
      const root = new BoxRenderable(renderer, {
        id: 'app-root',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        padding: 1,
      });
      renderer.root.add(root);

      const scrollBox = new ScrollBoxRenderable(renderer, {
        id: 'messages',
        flexGrow: 1,
        flexShrink: 1,
        border: true,
        borderStyle: 'rounded',
        borderColor: DARK_THEME.border,
        backgroundColor: DARK_THEME.bg,
        paddingX: 1,
        paddingY: 1,
        scrollY: true,
        scrollX: false,
      });
      scrollBox.stickyScroll = true;
      scrollBox.stickyStart = 'bottom';

      const text = new TextRenderable(renderer, {
        id: 'msg-content',
        content: 'Welcome line\nSecond line\nThird line\nFourth line',
        fg: DARK_THEME.fg,
        bg: DARK_THEME.bg,
        width: '100%',
      });
      scrollBox.add(text);
      root.add(scrollBox);

      const inputBox = new BoxRenderable(renderer, {
        id: 'input-area',
        flexShrink: 0,
        border: true,
        borderStyle: 'rounded',
        borderColor: DARK_THEME.border,
        paddingX: 1,
        backgroundColor: DARK_THEME.inputBg,
      });
      inputBox.add(
        new TextareaRenderable(renderer, {
          id: 'input',
          height: 3,
          width: '100%',
        }),
      );
      root.add(inputBox);

      renderer.start();
      await flush();

      // Mirrors app.ts rerender(): grow content then pin to bottom.
      text.content += '\n\n## You\n\ntest message\n\n## Copium\n\nreply text\n';
      scrollBox.scrollTop = scrollBox.scrollHeight;
      await flush();

      const sb = scrollBox as unknown as {
        scrollLeft: number;
        scrollTop: number;
        content: { translateX: number };
      };
      expect(Number.isNaN(sb.scrollLeft)).toBe(false);
      expect(sb.scrollLeft).toBe(0);
      expect(Number.isNaN(sb.content.translateX)).toBe(false);
      expect(sb.content.translateX).toBe(0);
    } finally {
      renderer.destroy();
    }
  });
});
