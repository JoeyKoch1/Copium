import { describe, it, expect } from 'bun:test';
import { createTestRenderer } from '@opentui/core/testing';
import { BoxRenderable, ScrollBoxRenderable, TextRenderable } from '@opentui/core';
import { buildSyntaxStyle, DARK_THEME } from '../../src/ui/theme';

type Setup = Awaited<ReturnType<typeof createTestRenderer>>;

function buildScrollBoxFixture(width = 60, height = 12) {
  let setup: Setup;
  let scrollBox: ScrollBoxRenderable;

  return {
    async init() {
      setup = await createTestRenderer({ width, height });
      const root = new BoxRenderable(setup.renderer, {
        id: 'app-root',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        padding: 1,
      });
      setup.renderer.root.add(root);
      scrollBox = new ScrollBoxRenderable(setup.renderer, {
        id: 'messages',
        flexGrow: 1,
        border: true,
        borderStyle: 'rounded',
        borderColor: DARK_THEME.border,
        backgroundColor: DARK_THEME.bg,
        scrollY: true,
        scrollX: false,
      });
      root.add(scrollBox);
      setup.renderer.start();
      await setup.flush();
      return this;
    },
    addCard(role: 'user' | 'assistant', content: string) {
      const isUser = role === 'user';
      const row = new BoxRenderable(setup.renderer, {
        flexDirection: 'row',
        width: '100%',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        alignItems: 'flex-start',
      });
      const card = new BoxRenderable(setup.renderer, {
        flexDirection: 'column',
        maxWidth: '85%',
        border: true,
        borderStyle: 'rounded',
        borderColor: isUser ? DARK_THEME.secondary : DARK_THEME.borderSubtle,
        backgroundColor: isUser ? DARK_THEME.userBubble : DARK_THEME.assistantBubble,
        paddingX: 1,
        paddingY: 1,
        marginBottom: 1,
      });
      const body = new TextRenderable(setup.renderer, {
        content,
        fg: DARK_THEME.fg,
        wrapMode: 'word',
        width: '100%',
      });
      card.add(body);
      row.add(card);
      scrollBox!.add(row);
      // Mirrors app.ts rerender(): pin to the bottom.
      scrollBox!.scrollTop = scrollBox!.scrollHeight;
    },
    async roll() {
      await setup.flush();
      return setup.captureCharFrame();
    },
    get scrollLeft() {
      return (scrollBox as unknown as { scrollLeft: number }).scrollLeft;
    },
    get translateX() {
      return (scrollBox as unknown as { content: { translateX: number } }).content.translateX;
    },
  };
}

describe('message cards (layout regression)', () => {
  it('places user message card on the right and assistant card on the left', async () => {
    const f = buildScrollBoxFixture(60, 20);
    await f.init();

    f.addCard('assistant', 'This is the assistant reply.');
    f.addCard('user', 'A question from the user.');
    const frame = await f.roll();

    const lines = frame.split('\n');
    const assistantLine = lines.findIndex((l) => l.includes('This is the'));
    const userLine = lines.findIndex((l) => l.includes('A question'));
    expect(assistantLine).toBeGreaterThan(-1);
    expect(userLine).toBeGreaterThan(-1);

    const aIdx = (lines[assistantLine] ?? '').indexOf('This is the');
    const uIdx = (lines[userLine] ?? '').indexOf('A question');

    // Assistant is left-aligned (starts close to the card frame left edge).
    expect(aIdx).toBeGreaterThan(-1);
    expect(aIdx).toBeLessThan(20);
    // User message is right-aligned (starts well to the right).
    expect(uIdx).toBeGreaterThan(15);
  });

  it('does not shift horizontally when adding a new card', async () => {
    const f = buildScrollBoxFixture(60, 12);
    await f.init();

    f.addCard('assistant', 'line one');
    await f.roll();
    expect(Number.isNaN(f.scrollLeft)).toBe(false);
    expect(f.translateX).toBe(0);

    f.addCard('user', 'line two that is longer than the previous card');
    await f.roll();

    expect(f.scrollLeft).toBe(0);
    expect(f.translateX).toBe(0);
    expect(Number.isNaN(f.scrollLeft)).toBe(false);
  });
});