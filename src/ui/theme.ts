import { SyntaxStyle, parseColor } from '@opentui/core';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { homedir } from 'node:os';

export interface CopiumTheme {
  name: string;
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

type StyleDef = CopiumTheme['styles'][string];

/** Build the syntax/markup style map from a small set of palette primitives. */
function makeStyles(p: {
  fg: string; muted: string; accent: string; secondary: string;
  keyword: string; string: string; number: string; fn: string; type: string;
  operator: string; variable: string; property: string; rawBg: string; heading1: string;
}): Record<string, StyleDef> {
  return {
    keyword: { fg: p.keyword, bold: true, italic: true },
    string: { fg: p.string },
    comment: { fg: p.muted, italic: true },
    number: { fg: p.number },
    function: { fg: p.fn },
    type: { fg: p.type },
    operator: { fg: p.operator },
    variable: { fg: p.variable },
    property: { fg: p.property },
    'punctuation.bracket': { fg: p.fg },
    'punctuation.delimiter': { fg: p.muted },
    'markup.heading': { fg: p.keyword, bold: true },
    'markup.heading.1': { fg: p.heading1, bold: true, underline: true },
    'markup.heading.2': { fg: p.secondary, bold: true },
    'markup.heading.3': { fg: p.keyword },
    'markup.bold': { fg: p.fg, bold: true },
    'markup.strong': { fg: p.fg, bold: true },
    'markup.italic': { fg: p.fg, italic: true },
    'markup.list': { fg: p.accent },
    'markup.quote': { fg: p.muted, italic: true },
    'markup.raw': { fg: p.string, bg: p.rawBg },
    'markup.raw.block': { fg: p.string, bg: p.rawBg },
    'markup.raw.inline': { fg: p.string, bg: p.rawBg },
    'markup.link': { fg: p.accent, underline: true },
    'markup.link.label': { fg: p.secondary, underline: true },
    'markup.link.url': { fg: p.accent, underline: true },
    'diff.plus': { fg: p.string },
    'diff.minus': { fg: p.variable },
    label: { fg: p.string },
    conceal: { fg: p.muted },
    'punctuation.special': { fg: p.muted },
    default: { fg: p.fg },
  };
}

/** Default Copium dark: near-black layers, warm orange primary. */
const COPIUM_DARK: CopiumTheme = (() => {
  const t: CopiumTheme = {
    name: 'copium-dark',
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
    styles: {},
  };
  t.styles = makeStyles({
    fg: t.fg, muted: t.muted, accent: t.accent, secondary: t.secondary,
    keyword: '#9d7cd8', string: '#7fd88f', number: '#f5a742', fn: '#fab283',
    type: '#e5c07b', operator: '#56b6c2', variable: '#e06c75', property: '#5c9cf5',
    rawBg: '#16181c', heading1: '#fab283',
  });
  return t;
})();

const TOKYO_NIGHT: CopiumTheme = (() => {
  const t: CopiumTheme = {
    name: 'tokyonight',
    bg: '#1a1b26',
    fg: '#c0caf5',
    muted: '#565f89',
    accent: '#7aa2f7',
    primary: '#7aa2f7',
    secondary: '#bb9af7',
    success: '#9ece6a',
    warning: '#e0af68',
    danger: '#f7768e',
    userBubble: '#292e42',
    assistantBubble: '#1f2233',
    border: '#292e42',
    borderSubtle: '#1f2233',
    panel: '#16161e',
    element: '#24283b',
    inputBg: '#16161e',
    styles: {},
  };
  t.styles = makeStyles({
    fg: t.fg, muted: t.muted, accent: t.accent, secondary: t.secondary,
    keyword: '#bb9af7', string: '#9ece6a', number: '#ff9e64', fn: '#7aa2f7',
    type: '#2ac3de', operator: '#89ddff', variable: '#f7768e', property: '#73daca',
    rawBg: '#1f2233', heading1: '#7aa2f7',
  });
  return t;
})();

const CATPPUCCIN: CopiumTheme = (() => {
  const t: CopiumTheme = {
    name: 'catppuccin',
    bg: '#1e1e2e',
    fg: '#cdd6f4',
    muted: '#6c7086',
    accent: '#f5c2e7',
    primary: '#cba6f7',
    secondary: '#89b4fa',
    success: '#a6e3a1',
    warning: '#f9e2af',
    danger: '#f38ba8',
    userBubble: '#313244',
    assistantBubble: '#24243a',
    border: '#45475a',
    borderSubtle: '#313244',
    panel: '#181825',
    element: '#313244',
    inputBg: '#181825',
    styles: {},
  };
  t.styles = makeStyles({
    fg: t.fg, muted: t.muted, accent: t.accent, secondary: t.secondary,
    keyword: '#cba6f7', string: '#a6e3a1', number: '#fab387', fn: '#89b4fa',
    type: '#94e2d5', operator: '#89dceb', variable: '#f38ba8', property: '#74c7ec',
    rawBg: '#24243a', heading1: '#cba6f7',
  });
  return t;
})();

const NORD: CopiumTheme = (() => {
  const t: CopiumTheme = {
    name: 'nord',
    bg: '#2e3440',
    fg: '#d8dee9',
    muted: '#4c566a',
    accent: '#88c0d0',
    primary: '#88c0d0',
    secondary: '#81a1c1',
    success: '#a3be8c',
    warning: '#ebcb8b',
    danger: '#bf616a',
    userBubble: '#3b4252',
    assistantBubble: '#353c49',
    border: '#4c566a',
    borderSubtle: '#3b4252',
    panel: '#292e39',
    element: '#3b4252',
    inputBg: '#292e39',
    styles: {},
  };
  t.styles = makeStyles({
    fg: t.fg, muted: t.muted, accent: t.accent, secondary: t.secondary,
    keyword: '#81a1c1', string: '#a3be8c', number: '#b48ead', fn: '#88c0d0',
    type: '#8fbcbb', operator: '#81a1c1', variable: '#bf616a', property: '#8fbcbb',
    rawBg: '#3b4252', heading1: '#88c0d0',
  });
  return t;
})();

const GRUVBOX: CopiumTheme = (() => {
  const t: CopiumTheme = {
    name: 'gruvbox',
    bg: '#282828',
    fg: '#ebdbb2',
    muted: '#928374',
    accent: '#fe8019',
    primary: '#fe8019',
    secondary: '#83a598',
    success: '#b8bb26',
    warning: '#fabd2f',
    danger: '#fb4934',
    userBubble: '#3c3836',
    assistantBubble: '#32302f',
    border: '#504945',
    borderSubtle: '#3c3836',
    panel: '#1d2021',
    element: '#3c3836',
    inputBg: '#1d2021',
    styles: {},
  };
  t.styles = makeStyles({
    fg: t.fg, muted: t.muted, accent: t.accent, secondary: t.secondary,
    keyword: '#fb4934', string: '#b8bb26', number: '#d3869b', fn: '#fabd2f',
    type: '#83a598', operator: '#8ec07c', variable: '#fb4934', property: '#83a598',
    rawBg: '#3c3836', heading1: '#fe8019',
  });
  return t;
})();

const MATRIX: CopiumTheme = (() => {
  const t: CopiumTheme = {
    name: 'matrix',
    bg: '#000000',
    fg: '#00ff41',
    muted: '#008f11',
    accent: '#00ff41',
    primary: '#00ff41',
    secondary: '#00cc33',
    success: '#00ff41',
    warning: '#ccff00',
    danger: '#ff2222',
    userBubble: '#0a1a0a',
    assistantBubble: '#001100',
    border: '#008f11',
    borderSubtle: '#003b00',
    panel: '#000000',
    element: '#0a1a0a',
    inputBg: '#000000',
    styles: {},
  };
  t.styles = makeStyles({
    fg: t.fg, muted: t.muted, accent: t.accent, secondary: t.secondary,
    keyword: '#00ff41', string: '#ccff00', number: '#ccff00', fn: '#00ff41',
    type: '#00cc33', operator: '#00cc33', variable: '#88ff88', property: '#00cc33',
    rawBg: '#0a1a0a', heading1: '#00ff41',
  });
  return t;
})();

const DRACULA: CopiumTheme = (() => {
  const t: CopiumTheme = {
    name: 'dracula',
    bg: '#282a36',
    fg: '#f8f8f2',
    muted: '#6272a4',
    accent: '#bd93f9',
    primary: '#bd93f9',
    secondary: '#8be9fd',
    success: '#50fa7b',
    warning: '#ffb86c',
    danger: '#ff5555',
    userBubble: '#44475a',
    assistantBubble: '#343746',
    border: '#44475a',
    borderSubtle: '#343746',
    panel: '#21222c',
    element: '#44475a',
    inputBg: '#21222c',
    styles: {},
  };
  t.styles = makeStyles({
    fg: t.fg, muted: t.muted, accent: t.accent, secondary: t.secondary,
    keyword: '#ff79c6', string: '#f1fa8c', number: '#bd93f9', fn: '#50fa7b',
    type: '#8be9fd', operator: '#ff79c6', variable: '#f8f8f2', property: '#66d9ef',
    rawBg: '#343746', heading1: '#bd93f9',
  });
  return t;
})();

const EVERFOREST: CopiumTheme = (() => {
  const t: CopiumTheme = {
    name: 'everforest',
    bg: '#2b3339',
    fg: '#d3c6aa',
    muted: '#859289',
    accent: '#a7c080',
    primary: '#a7c080',
    secondary: '#7fbbb3',
    success: '#83c092',
    warning: '#dbbc7f',
    danger: '#e67e80',
    userBubble: '#3a454a',
    assistantBubble: '#323c41',
    border: '#414b50',
    borderSubtle: '#3a454a',
    panel: '#323c41',
    element: '#3a454a',
    inputBg: '#323c41',
    styles: {},
  };
  t.styles = makeStyles({
    fg: t.fg, muted: t.muted, accent: t.accent, secondary: t.secondary,
    keyword: '#e67e80', string: '#a7c080', number: '#d699b6', fn: '#83c092',
    type: '#dbbc7f', operator: '#e69875', variable: '#d3c6aa', property: '#7fbbb3',
    rawBg: '#3a454a', heading1: '#a7c080',
  });
  return t;
})();

const KANAGAWA: CopiumTheme = (() => {
  const t: CopiumTheme = {
    name: 'kanagawa',
    bg: '#1f1f28',
    fg: '#dcd7ba',
    muted: '#727169',
    accent: '#7e9cd8',
    primary: '#7e9cd8',
    secondary: '#957fb8',
    success: '#98bb6c',
    warning: '#ffa066',
    danger: '#e46876',
    userBubble: '#2a2a37',
    assistantBubble: '#262633',
    border: '#2a2a37',
    borderSubtle: '#262633',
    panel: '#16161d',
    element: '#2a2a37',
    inputBg: '#16161d',
    styles: {},
  };
  t.styles = makeStyles({
    fg: t.fg, muted: t.muted, accent: t.accent, secondary: t.secondary,
    keyword: '#957fb8', string: '#98bb6c', number: '#d27e99', fn: '#7e9cd8',
    type: '#7aa89f', operator: '#c34043', variable: '#e46876', property: '#7aa89f',
    rawBg: '#262633', heading1: '#7e9cd8',
  });
  return t;
})();

const SOLARIZED_DARK: CopiumTheme = (() => {
  const t: CopiumTheme = {
    name: 'solarized-dark',
    bg: '#002b36',
    fg: '#93a1a1',
    muted: '#586e75',
    accent: '#268bd2',
    primary: '#268bd2',
    secondary: '#2aa198',
    success: '#859900',
    warning: '#b58900',
    danger: '#dc322f',
    userBubble: '#073642',
    assistantBubble: '#03313d',
    border: '#094654',
    borderSubtle: '#073642',
    panel: '#01252e',
    element: '#073642',
    inputBg: '#01252e',
    styles: {},
  };
  t.styles = makeStyles({
    fg: t.fg, muted: t.muted, accent: t.accent, secondary: t.secondary,
    keyword: '#859900', string: '#2aa198', number: '#d33682', fn: '#268bd2',
    type: '#b58900', operator: '#cb4b16', variable: '#dc322f', property: '#268bd2',
    rawBg: '#073642', heading1: '#268bd2',
  });
  return t;
})();

const ONE_DARK: CopiumTheme = (() => {
  const t: CopiumTheme = {
    name: 'one-dark',
    bg: '#282c34',
    fg: '#abb2bf',
    muted: '#5c6370',
    accent: '#61afef',
    primary: '#61afef',
    secondary: '#c678dd',
    success: '#98c379',
    warning: '#e5c07b',
    danger: '#e06c75',
    userBubble: '#3e4451',
    assistantBubble: '#2f343d',
    border: '#3e4451',
    borderSubtle: '#2f343d',
    panel: '#21252b',
    element: '#3e4451',
    inputBg: '#21252b',
    styles: {},
  };
  t.styles = makeStyles({
    fg: t.fg, muted: t.muted, accent: t.accent, secondary: t.secondary,
    keyword: '#c678dd', string: '#98c379', number: '#d19a66', fn: '#61afef',
    type: '#e5c07b', operator: '#56b6c2', variable: '#e06c75', property: '#61afef',
    rawBg: '#2f343d', heading1: '#61afef',
  });
  return t;
})();

export const BUILTIN_THEMES: CopiumTheme[] = [
  COPIUM_DARK,
  TOKYO_NIGHT,
  CATPPUCCIN,
  NORD,
  GRUVBOX,
  MATRIX,
  DRACULA,
  EVERFOREST,
  KANAGAWA,
  SOLARIZED_DARK,
  ONE_DARK,
];

export function getTheme(name: string | undefined): CopiumTheme {
  if (!name) return COPIUM_DARK;
  return BUILTIN_THEMES.find((t) => t.name === name) ?? COPIUM_DARK;
}

export function themeNames(): string[] {
  return BUILTIN_THEMES.map((t) => t.name);
}

/**
 * Load custom themes from ~/.config/copium/themes/*.json and
 * <workspace>/.copium/themes/*.json. Partial definitions are merged over
 * copium-dark defaults, so a file that only sets `accent` works.
 */
export async function loadCustomThemes(workspaceRoot?: string): Promise<CopiumTheme[]> {
  const dirs: string[] = [
    path.join(homedir(), '.config', 'copium', 'themes'),
  ];
  if (workspaceRoot) {
    dirs.push(path.join(workspaceRoot, '.copium', 'themes'));
  }
  const custom: CopiumTheme[] = [];
  for (const dir of dirs) {
    let files: string[];
    try {
      files = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const f of files.filter((x) => x.endsWith('.json'))) {
      try {
        const raw = JSON.parse(await fs.readFile(path.join(dir, f), 'utf-8'));
        const name = typeof raw.name === 'string' ? raw.name : f.replace('.json', '');
        const merged: CopiumTheme = {
          ...COPIUM_DARK,
          ...raw,
          name,
          styles: { ...makeDefaultStyles(raw), ...(raw.styles ?? {}) },
        };
        custom.push(merged);
      } catch {
        // skip invalid theme files
      }
    }
  }
  return custom;
}

/** Derive syntax styles from a partial palette; fall back to defaults. */
function makeDefaultStyles(partial: Partial<CopiumTheme>): Record<string, StyleDef> {
  return makeStyles({
    fg: partial.fg ?? COPIUM_DARK.fg,
    muted: partial.muted ?? COPIUM_DARK.muted,
    accent: partial.accent ?? COPIUM_DARK.accent,
    secondary: partial.secondary ?? COPIUM_DARK.secondary,
    keyword: partial.secondary ?? COPIUM_DARK.styles.keyword!.fg!,
    string: partial.success ?? COPIUM_DARK.styles.string!.fg!,
    number: partial.warning ?? COPIUM_DARK.styles.number!.fg!,
    fn: partial.accent ?? COPIUM_DARK.styles.function!.fg!,
    type: partial.warning ?? COPIUM_DARK.styles.type!.fg!,
    operator: COPIUM_DARK.styles.operator!.fg!,
    variable: partial.danger ?? COPIUM_DARK.styles.variable!.fg!,
    property: partial.secondary ?? COPIUM_DARK.styles.property!.fg!,
    rawBg: partial.assistantBubble ?? COPIUM_DARK.styles['markup.raw']!.bg!,
    heading1: partial.accent ?? COPIUM_DARK.styles['markup.heading.1']!.fg!,
  });
}

// Back-compat alias for existing imports.
export const DARK_THEME: CopiumTheme = COPIUM_DARK;

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
