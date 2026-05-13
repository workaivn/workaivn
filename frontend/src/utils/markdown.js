import { marked } from "marked";
import hljs from "highlight.js";
import DOMPurify from "dompurify";

/* =========================
   MARKED CONFIG
========================= */

marked.setOptions({
  gfm: true,
  breaks: true
});

/* =========================
   CODE BLOCK UI
========================= */

const renderer =
  new marked.Renderer();

renderer.code = function({
  text,
  lang
}) {

  let highlighted = text;

  if (
    lang &&
    hljs.getLanguage(lang)
  ) {

    try {

      highlighted =
        hljs.highlight(
          text,
          {
            language: lang
          }
        ).value;

    } catch {}

  }

  return `
<div class="codeWrap">

  <div class="codeTop">

    <span class="codeLang">
      ${lang || "CODE"}
    </span>

    <button
      class="copyBtn"
      onclick="
navigator.clipboard.writeText(
this.parentElement.nextElementSibling.innerText
)
"
    >
      Copy
    </button>

  </div>

  <pre class="codePre">
<code class="hljs ${lang || ""}">
${highlighted}
</code>
  </pre>

</div>
`;

};

marked.use({ renderer });

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

  fixed =
    fixed.replace(
      /```([a-zA-Z0-9+#-]*)([^\n])/g,
      "```$1\n$2"
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