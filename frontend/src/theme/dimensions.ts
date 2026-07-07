/** 横長バー（ヘッダー / タブ / ツールバー等）の正典高さ（px, border-box）。
 *  全バーがこの定数を参照することで、ドリフトを防ぐ。 */
export const BAR_HEIGHT = 37;

/** MUI Tabs / Tab の minHeight 用。1px の bottom border を除いた内容高さ。 */
export const TAB_CONTENT_HEIGHT = BAR_HEIGHT - 1; // 36
