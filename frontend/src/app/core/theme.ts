/** Pure theme logic, free of Angular so it can be tested directly. */
export type ThemeChoice = 'light' | 'system' | 'dark';
export const THEME_CHOICES: readonly ThemeChoice[] = ['light', 'system', 'dark'];

export function isThemeChoice(value: unknown): value is ThemeChoice {
  return value === 'light' || value === 'system' || value === 'dark';
}

/** The theme that is applied for a choice. "system" follows the operating system. */
export function resolveTheme(choice: ThemeChoice, systemPrefersDark: boolean): 'light' | 'dark' {
  if (choice === 'system') return systemPrefersDark ? 'dark' : 'light';
  return choice;
}
