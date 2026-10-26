- Attach the assigned tab with `browser.open` (use tab name `job-{{id}}`) **without `url`**, and complete browser initialization below before navigating. For a first fill, or recovery after a confirmed pre-draft failure with no existing draft on file, then use `tab.goto` to open the posting, find the application form and work through every page. For resumed fills with an existing draft, follow exact draft recovery above instead; do not navigate over an unsaved form. Re-observe after each navigation, and verify fields hold what you entered before moving on.
- **Browser initialization and WebMCP bridge cleanup:** Every `browser.open` MUST include `init_scripts: ["globalThis.__ompWebMcpBridge_v1?.uninstall?.();"]`. Raw Puppeteer access can initialize another optional WebMCP bridge after those scripts were registered. Immediately after opening/adopting the tab, initialize that raw context and register cleanup last, then uninstall any bridge on the existing document without reloading:
  ```js
  await tab.run(async ({ page }) => {
    await page.evaluateOnNewDocument("globalThis.__ompWebMcpBridge_v1?.uninstall?.();");
  });
  await tab.evaluate("globalThis.__ompWebMcpBridge_v1?.uninstall?.();");
  ```
  Verify that `Object.getOwnPropertyNames(navigator)` does not contain `modelContext`. Keep using this configured tab; repeat initialization after any new `browser.open` or replacement of the raw page. Never tamper with `Function.prototype.toString` or other native browser APIs, and do not bypass website protections; WebMCP page tools are not used by fill.
- **Prefill each form page first.** Once a page of the application form is showing (after any sign-in, and after any Apply button that opens the form), run the prefill script before you read or touch the fields, in one eval call with a timeout of 180 seconds:
  ```js
  const { prefill } = await import("{{prefillModule}}");
  console.log(await prefill(tab, "{{prefillFacts}}"));
  ```
  It fills, at a person's pace, only what the candidate details settle plainly: name, contact details, address, links, current job, school, the resume upload, and the plain work-authorisation, sponsorship, age, EEO, referral, source and text-message questions. It prints what it filled, every field it left (required ones first, marked `*`, with the options and why) and `more`. When `more` is true it ran out of time: run it again, and it carries on. Then work only through the `left` fields as the rules below say; do not observe, re-enter or re-check the fields it filled unless the site later flags one. A field it left with "already holds something else" was filled by the site (often from the resume): check that one. It reads only the top-level page: when the form sits in a frame, open the frame's own address in the tab first. Run it again on each new page of a multi-page form. If it throws, carry on by hand. Never run it in verification-only mode.
- **Operate the page the way a person would** (the prefill script already does). Sites score how a form is filled, and a form completed in seconds with no pointer movement gets blocked or handed a CAPTCHA that cannot be passed.
  - After a page loads, wait a few seconds and scroll through it once before touching anything.
  - One field at a time, top to bottom, each in its own step: click into the field (`tab.click`), then type (`tab.type`). Do not use `tab.fill`, do not set values through `evaluate`, and do not batch many fields into one call.
  - Open dropdowns and pick options by clicking them. Use `tab.select` only for native `<select>` elements, after clicking the control.
  - Scroll with `tab.wheel` or `tab.scroll` in moderate steps to bring things into view.
  - Your clicks and keystrokes are paced automatically, so each action takes a moment; that is intended. Never try to speed it up or work around it.
  - Type long answers in pieces of about 150 characters per `tab.type` call so no single call runs past its time limit. If a call does time out, check what the field holds before typing again.
  - If a typed value needs correcting, click the field, select its contents (Control+A) and retype, rather than assigning the value.
