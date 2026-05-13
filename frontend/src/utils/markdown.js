import { marked } from "marked";
import hljs from "highlight.js";
import DOMPurify from "dompurify";

/* =========================
   MARKED CONFIG
========================= */

marked.setOptions({
  gfm: true,
  breaks: true,
  headerIds: false,
  mangle: false,
  pedantic: false
});

/* =========================
   CODE BLOCK UI
========================= */

marked.setOptions({
  gfm: true,
  breaks: true,
  pedantic: false,

  highlight(code, lang) {

    if (
      lang &&
      hljs.getLanguage(lang)
    ) {

      try {

        return hljs.highlight(
          code,
          {
            language: lang
          }
        ).value;

      } catch {}

    }

    return code;
  }
});

/* =========================
   FIX STREAM CODE
========================= */

function fixCodeBlock(
  text = ""
) {

  let fixed =
    String(text || "");

  fixed = fixed.replace(
    /^\s*1\s*$/gm,
    ""
  );

  fixed =
    fixed.replace(/\r/g, "");

  fixed =
    fixed.replace(
      /```([a-zA-Z0-9+#-]*)([^\n])/g,
      "```$1\n$2"
    );
	
	fixed = fixed.replace(
	  /^```html$/gm,
	  "\n```html"
	);

	fixed = fixed.replace(
	  /```\s+html/g,
	  "```html"
	);

	fixed = fixed.replace(
	  /```\s+css/g,
	  "```css"
	);

	fixed = fixed.replace(
	  /```\s+javascript/g,
	  "```javascript"
	);

	fixed = fixed.replace(
	  /```\s+js/g,
	  "```js"
	);

	/* REMOVE SINGLE 1 */

	fixed = fixed.replace(
	  /^\s*1\s*$/gm,
	  ""
	);


  const count =
    (
      fixed.match(/```/g)
      || []
    ).length;

  if (count % 2 !== 0) {
    fixed += "\n```";
  }

  return fixed;

}

/* =========================
   MAIN RENDER
========================= */

export function renderMarkdown(
  text = ""
) {

  const fixed =
    fixCodeBlock(text);

  const html =
    marked.parse(fixed);

  return DOMPurify.sanitize(
    html
  );

}