/** The text a successful sign-in shows in the green banner. A test or a screenshot reads it. */
export const SIGNED_IN_BANNER = "SIGNED-IN-OK";

/** The default username field value. */
export const DEFAULT_USERNAME = "tester";

/**
 * Whether the entered code is the expected one. Surrounding spaces are ignored, since a phone's keyboard
 * often adds them. This is a test page with a fixed code; it is not a second factor.
 *
 * @param entered The value typed into the code field.
 * @param expected The code baked in at build time.
 */
export function checkCode(entered: string, expected: string): boolean {
  return entered.trim() === expected;
}

/**
 * Render the sign-in form into `root`. Nothing is sent over the network. The banner is created only after a
 * correct code, so the success text is not in the page before sign-in.
 *
 * @param root The element to render into. Its previous content is replaced.
 * @param expectedCode The code a correct sign-in needs.
 */
export function mountOtpPage(root: HTMLElement, expectedCode: string): void {
  const doc = root.ownerDocument;
  root.replaceChildren();

  const heading = doc.createElement("h1");
  heading.textContent = "Sign in";

  const form = doc.createElement("form");
  form.noValidate = true;
  const username = field(doc, "username", "Username", "text", DEFAULT_USERNAME);
  const code = field(doc, "code", "One-time code", "text", "");
  code.input.inputMode = "numeric";
  code.input.autocomplete = "one-time-code";
  const submit = doc.createElement("button");
  submit.type = "submit";
  submit.textContent = "Submit";
  form.append(username.label, code.label, submit);

  const result = doc.createElement("p");
  result.setAttribute("role", "status");
  result.id = "result";

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    root.querySelector("#banner")?.remove();
    if (checkCode(code.input.value, expectedCode)) {
      result.textContent = "Signed in";
      const banner = doc.createElement("div");
      banner.id = "banner";
      banner.className = "banner-ok";
      banner.textContent = SIGNED_IN_BANNER;
      root.append(banner);
    } else {
      result.textContent = "Wrong code";
    }
  });

  root.append(heading, form, result);
}

function field(
  doc: Document,
  id: string,
  text: string,
  type: string,
  value: string,
): { label: HTMLLabelElement; input: HTMLInputElement } {
  const label = doc.createElement("label");
  label.htmlFor = id;
  label.textContent = `${text} `;
  const input = doc.createElement("input");
  input.id = id;
  input.name = id;
  input.type = type;
  input.value = value;
  label.append(input);
  return { label, input };
}
