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

  fixed =
    fixed.replace(/\r/g, "");

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