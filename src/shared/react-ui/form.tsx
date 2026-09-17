import { addEventListener } from "@base-ui/utils/addEventListener";
import { useMergedRefs } from "@base-ui/utils/useMergedRefs";
import { useCallback, useEffect, useRef } from "react";

import { createSafeContext } from "@/shared/react/safe-context";

function mergeSelectors(...selectors: string[]): string {
  return selectors
    .map((selector) => selector.trim())
    .filter((selector) => selector.length > 0)
    .join(", ");
}

function isMacOS(): boolean {
  return navigator.userAgent.includes("Macintosh");
}

type FormConfig = Readonly<{
  selectors?: Readonly<{
    singleLine?: string;
    multiLine?: string;
  }>;
}>;

const FormConfigContext = createSafeContext<FormConfig>({
  defaultValue: {},
  displayName: "FormConfigContext",
});

const SINGLE_LINE_FIELD_SELECTORS =
  'input, select, [role="checkbox"], [role="combobox"], [role="radio"], [role="slider"], [role="spinbutton"], [role="switch"], [role="textbox"]:not([aria-multiline="true"])';
const MULTI_LINE_FIELD_SELECTORS = 'textarea, [role="textbox"][aria-multiline="true"]';
const SUBMIT_BUTTON_SELECTORS = 'input[type="submit"], button[type="submit"], button:not([type])';

type FormProps = React.ComponentPropsWithRef<"form"> & {
  /** The shortcut that triggers the submit event. */
  submitHotKey?: "none" | "enter" | "cmd+enter";
  /**
   * Whether to trigger the submit event only when a type="submit" button exists inside the <form>.
   * The browser default is true, but this component defaults to false to avoid ambiguity.
   */
  submitterRequired?: boolean;
};

function Form(props: FormProps): React.ReactNode {
  const { submitHotKey = "cmd+enter", submitterRequired = false, children, ref, ...restProps } = props;
  const { selectors: hotKeySelectors = {} } = FormConfigContext.useSafeContext();

  const singleLineFieldSelectors = mergeSelectors(SINGLE_LINE_FIELD_SELECTORS, hotKeySelectors.singleLine ?? "");
  const multiLineFieldSelectors = mergeSelectors(MULTI_LINE_FIELD_SELECTORS, hotKeySelectors.multiLine ?? "");
  const allFieldSelectors = mergeSelectors(singleLineFieldSelectors, multiLineFieldSelectors);

  const formElementRef = useRef<HTMLFormElement>(null);
  const formRef = useMergedRefs(ref, formElementRef);

  const handleSubmitKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const { key, ctrlKey, metaKey } = event;
      const cmdKey = isMacOS() ? metaKey : ctrlKey;

      const { current: formElement } = formElementRef;
      const submitElement = formElement?.querySelector<HTMLElement>(SUBMIT_BUTTON_SELECTORS) ?? null;
      const { activeElement } = document;

      if (
        key !== "Enter" ||
        formElement == undefined ||
        (submitterRequired && submitElement == undefined) ||
        activeElement == undefined ||
        !formElement.contains(activeElement)
      ) {
        return;
      }

      // Prevent the browser's default submit event.
      if (activeElement.closest("input, select")) {
        event.preventDefault();
      }

      // Enter: trigger when focus is inside a single-line field in the form.
      const enter = () => activeElement.closest(singleLineFieldSelectors);

      // Cmd(Ctrl)+Enter: trigger when focus is inside any field in the form.
      const cmdEnter = () => cmdKey && activeElement.closest(allFieldSelectors);

      // For "enter", allow both Enter and Cmd+Enter.
      if (submitHotKey === "enter" && (enter() || cmdEnter())) {
        formElement.requestSubmit(submitElement);
      }

      // For "cmd+enter", allow only Cmd+Enter.
      else if (submitHotKey === "cmd+enter" && cmdEnter()) {
        formElement.requestSubmit(submitElement);
      }
    },
    [formElementRef, submitterRequired, submitHotKey, singleLineFieldSelectors, allFieldSelectors],
  );

  useEffect(() => addEventListener(document, "keydown", handleSubmitKeyDown), [handleSubmitKeyDown]);

  return (
    <form ref={formRef} {...restProps}>
      {children}
    </form>
  );
}

const FormConfigProvider = FormConfigContext.Provider;

export { Form, FormConfigProvider };
