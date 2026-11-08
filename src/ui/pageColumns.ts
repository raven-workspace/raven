/** The centred page columns whose title bar follows them (TitleBar `column`): max width and side padding, in px. */
export interface PageColumn {
  max: number;
  inset: number;
}
export const DASHBOARD_COLUMN: PageColumn = { max: 1120, inset: 32 };
export const SETTINGS_COLUMN: PageColumn = { max: 720, inset: 24 };
