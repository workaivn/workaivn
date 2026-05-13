import { marked } from "marked";
import hljs from "highlight.js";
import DOMPurify from "dompurify";

const renderer =
  new marked.Renderer();

renderer.code = ({
  text,
  lang
}) => {

  const language =
    lang || "plaintext";

  let code = text;

  if (
    hljs.getLanguage(language)
  ) {

    try {

      code =
        hljs.highlight(
          text,
          {
            language
          }
        ).value;

    } catch {}

  }

  return `
<div class="codeWrap">

  <div class="codeTop">

    <span class="codeLang">
      ${language.toUpperCase()}
    </span>

    <button
      class="codeBtn"
      onclick="
navigator.clipboard.writeText(
this.closest('.codeWrap')
.querySelector('code')
.innerText
)
"
    >
      Copy
    </button>

  </div>

  <pre class="codePre">
<code class="hljs ${language}">
${code}
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