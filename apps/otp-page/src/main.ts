import { mountOtpPage } from "./page";

const root = document.getElementById("app");
if (!root) throw new Error("the page has no #app element");

// WHY the code is a build-time constant: the page is a test fixture. `OTP_CODE` is read when the page is
// built (`npm -w otp-page run serve` builds it first), so the value is fixed in the served bundle.
mountOtpPage(root, __OTP_CODE__);
