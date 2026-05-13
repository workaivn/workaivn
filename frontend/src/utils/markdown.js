import { marked } from "marked";
import hljs from "highlight.js";
import DOMPurify from "dompurify";

const renderer =
  new marked.Renderer();

renderer.code = ({ text, lang }) => {

  const language = lang || "plaintext";

  let highlighted = text;

  if (hljs.getLanguage(language)) {
    try {
      highlighted = hljs.highlight(
        text,
        { language }
      ).value;
    } catch {}
  }

  const encoded =
    encodeURIComponent(text);

  return `
<div class="codeWrap">

  <div class="codeTop">

    <span class="codeLang">
      ${language.toUpperCase()}
    </span>

    <button
      class="codeBtn"
      data-code="${encoded}"
    >
      Copy
    </button>

  </div>

  <pre class="codePre">
<code class="hljs ${language}">
${highlighted}
</code>
  </pre>

</div>
`;
};

marked.use({ renderer });


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
   FIX STREAM CODE
========================= */

function fixCodeBlock(
  text = ""
) {

  let fixed =
    String(text || "");

  fixed =
    fixed.replace(/\r/g, "");

  /* FIX html<!DOCTYPE */

  fixed =
    fixed.replace(
      /^html\s*</gm,
      "```html\n<"
    );

  /* FIX jsconst */

  fixed =
    fixed.replace(
      /^javascript\s+/gm,
      "```javascript\n"
    );

  /* auto close */

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

  const clean =
    DOMPurify.sanitize(html);

  setTimeout(() => {

    document
      .querySelectorAll(".codeBtn")
      .forEach((btn) => {

        if (btn.dataset.binded)
          return;

        btn.dataset.binded = "1";

        btn.onclick = () => {

          const code =
            decodeURIComponent(
              btn.dataset.code || ""
            );

          navigator.clipboard
            .writeText(code);

          btn.innerText = "Copied";

          setTimeout(() => {
            btn.innerText = "Copy";
          }, 1200);

        };

      });

  }, 0);

  return clean;
}