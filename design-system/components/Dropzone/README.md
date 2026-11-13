# Dropzone

File target for the PDF invoice in the dialog's upload mode: drag and drop or click to open the file picker.

Markup: `.mcg-drop` with `role="button"` and `tabindex="0"`, wrapping a hidden `<input type="file" accept="application/pdf">`. Once a file is chosen it is replaced by `.mcg-file`. The consumer provides the file handler and the validation result.

- States: idle (dashed `line-strong`), drag over (`mcg-drop--over`, solid `accent` on `accent-soft`), error (`mcg-drop--error` plus a `mcg-field__error` line).
- Validate on the client before upload: PDF only (MIME type and `.pdf`), 10 MB at most. Error copy names the rule that failed.
- Enter and Space open the picker. Dropping a second file replaces the first.
- One file per claim. No multi-select.
