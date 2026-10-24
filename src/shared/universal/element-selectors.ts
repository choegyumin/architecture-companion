export const SINGLE_LINE_FIELD_SELECTORS = [
  "input",
  "select",
  '[role="checkbox"]',
  '[role="combobox"]',
  '[role="radio"]',
  '[role="slider"]',
  '[role="spinbutton"]',
  '[role="switch"]',
  '[role="textbox"]:not([aria-multiline="true"])',
].join(", ");

export const MULTI_LINE_FIELD_SELECTORS = [
  "textarea",
  '[role="textbox"][aria-multiline="true"]',
  '[contenteditable]:not([contenteditable="false"])',
].join(", ");

export const FIELD_SELECTORS = [SINGLE_LINE_FIELD_SELECTORS, MULTI_LINE_FIELD_SELECTORS].join(", ");

export const ACTION_BUTTON_SELECTORS = ["a[href]", "button", '[role="button"]', '[role="link"]'].join(", ");

export const SUBMIT_BUTTON_SELECTORS = [
  'button[type="submit"]',
  "form button:not([type])",
  'input[type="submit"]',
].join(", ");
