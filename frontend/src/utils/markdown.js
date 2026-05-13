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

const renderer =
  new marked.Renderer();

renderer.code = function (
  code,
  infostring
) {

  const lang =
    (infostring || "plaintext")
      .trim()
      .toLowerCase();

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

  let fixed =
    fixCodeBlock(text);

  fixed = fixed.replace(
    /^html\s+</gm,
    "```html\n<"
  );

  fixed = fixed.replace(
    /<\/html>$/gm,
    "</html>\n```"
  );

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