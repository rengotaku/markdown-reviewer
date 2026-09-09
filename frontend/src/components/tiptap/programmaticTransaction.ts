/**
 * Meta key marking a transaction as originating from our own code — loading
 * a file, recovering the blank-line counts a freshly-loaded doc needs, an
 * external reload, a revision restore — rather than a user edit (#293).
 *
 * TiptapEditor's onUpdate gate takes the opposite stance from an earlier
 * version of this fix: instead of enumerating every DOM event / command
 * call site that counts as "the user edited" (paste, cut, drop, toolbar
 * buttons, slash commands, task-item checkboxes, StarterKit's built-in
 * keymap, ...) — a list that is open-ended and, as codex review pointed
 * out, silently drops whichever input path isn't on it yet — the gate now
 * treats *any* transaction that actually changed the document
 * (`transaction.docChanged`) as a genuine user edit, unless it carries this
 * meta. The list to get right shrinks to "every place WE dispatch a
 * document-changing transaction that isn't a user edit", which is small
 * and enumerable by grep (see TiptapEditor.tsx / BlankLines.ts).
 *
 * `editor.commands.setContent(..., { emitUpdate: false })` doesn't need
 * this: its own `preventUpdate` meta already suppresses the "update" event
 * entirely (tiptap core checks it on the root transaction before onUpdate
 * ever runs), and every reload path (open, external reload, revision
 * restore) goes through that one call site.
 */
export const PROGRAMMATIC_TRANSACTION_META = "programmaticTransaction";
