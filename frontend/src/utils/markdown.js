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
  mangle: false
});

/* =========================
   CODE BLOCK UI
========================= */

const renderer =
  new marked.Renderer();

renderer.code = function (
  code,
  language
) {

  const lang =
    language || "plaintext";

  let highlighted = code;

  if (
    hljs.getLanguage(lang)
  ) {

    try {

      highlighted =
        hljs.highlight(
          code,
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
      ${lang.toUpperCase()}
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
<code class="hljs ${lang}">
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
	  html,
	  {
		ALLOWED_TAGS: [
		  "pre",
		  "code",
		  "span",
		  "div",
		  "button",
		  "p",
		  "br"
		],
		ALLOWED_ATTR: [
		  "class",
		  "onclick"
		]
	  }
	);

}