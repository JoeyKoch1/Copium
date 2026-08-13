import { SyntaxStyle } from '@opentui/core';
import { parseColor } from '@opentui/core';

export interface CopiumTheme {
  bg: string;
  fg: string;
  muted: string;
  accent: string;
  primary: string;
  secondary: string;
  success: string;
  warning: string;
  danger: string;
  userBubble: string;
  assistantBubble: string;
  border: string;
  borderSubtle: string;
  panel: string;
  element: string;
  inputBg: string;
  styles: Record<string, { fg?: string; bg?: string; bold?: boolean; italic?: boolean; underline?: boolean }>;
}

/**
 * opencode-inspired dark palette:
 * near-black layers (#0a0a0a → #1e1e1e), warm orange primary (#fab283),
 * blue secondary (#5c9cf5), muted grays for borders/text.
 */
export const DARK_THEME: CopiumTheme = {
  bg: '#0a0a0a',
  fg: '#eeeeee',
  muted: '#808080',
  accent: '#fab283',
  primary: '#fab283',
  secondary: '#5c9cf5',
  success: '#7fd88f',
  warning: '#f5a742',
  danger: '#e06c75',
  userBubble: '#1e1e1e',
  assistantBubble: '#141414',
  border: '#3c3c3c',
  borderSubtle: '#282828',
  panel: '#141414',
  element: '#1e1e1e',
  inputBg: '#141414',
  styles: {
    keyword: { fg: '#9d7cd8', bold: true, italic: true },
    string: { fg: '#7fd88f' },
    comment: { fg: '#808080', italic: true },
    number: { fg: '#f5a742' },
    function: { fg: '#fab283' },
    type: { fg: '#e5c07b' },
    operator: { fg: '#56b6c2' },
    variable: { fg: '#e06c75' },
    property: { fg: '#5c9cf5' },
    'punctuation.bracket': { fg: '#eeeeee' },
    'punctuation.delimiter': { fg: '#808080' },
    'markup.heading': { fg: '#9d7cd8', bold: true },
    'markup.heading.1': { fg: '#fab283', bold: true, underline: true },
    'markup.heading.2': { fg: '#5c9cf5', bold: true },
    'markup.heading.3': { fg: '#9d7cd8' },
    'markup.bold': { fg: '#eeeeee', bold: true },
    'markup.strong': { fg: '#eeeeee', bold: true },
    'markup.italic': { fg: '#eeeeee', italic: true },
    'markup.list': { fg: '#fab283' },
    'markup.quote': { fg: '#808080', italic: true },
    'markup.raw': { fg: '#7fd88f', bg: '#16181c' },
    'markup.raw.block': { fg: '#7fd88f', bg: '#101215' },
    'markup.raw.inline': { fg: '#7fd88f', bg: '#16181c' },
    'markup.link': { fg: '#fab283', underline: true },
    'markup.link.label': { fg: '#5c9cf5', underline: true },
    'markup.link.url': { fg: '#fab283', underline: true },
    'diff.plus': { fg: '#7fd88f' },
    'diff.minus': { fg: '#e06c75' },
    label: { fg: '#7fd88f' },
    conceal: { fg: '#6a6a6a' },
    'punctuation.special': { fg: '#808080' },
    default: { fg: '#eeeeee' },
  },
};

export function buildSyntaxStyle(theme: CopiumTheme): SyntaxStyle {
  const styles: Record<string, any> = {};
  for (const [name, def] of Object.entries(theme.styles)) {
    const style: any = {};
    if (def.fg) style.fg = parseColor(def.fg);
    if (def.bg) style.bg = parseColor(def.bg);
    if (def.bold) style.bold = true;
    if (def.italic) style.italic = true;
    if (def.underline) style.underline = true;
    styles[name] = style;
  }
  return SyntaxStyle.fromStyles(styles);
}