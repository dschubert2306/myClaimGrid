# Select

Native `<select>` with square styling and a drawn chevron, used for the year selector and the person picker.

Markup: `<span class="mcg-select"><select>…</select></span>`. The consumer provides the options and the bound form control. Use the native element so keyboard and screen reader behaviour come for free.

- Year selector: lists only years that have data, plus the current year, newest first. Defaults to the current year. Sits in the top bar.
- Person picker in the dialog: required, starts on "Bitte wählen" / "Please choose" with no value.
- `mcg-select--sm` for the narrow top bar.
- Don't build a custom listbox for these. If a richer picker is ever needed, use CDK overlay and keep the same trigger look.
