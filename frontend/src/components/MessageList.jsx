import React,{
useState
} from "react";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

function fixCodeBlock(text = "") {

  let fixed = String(text || "");
  
	  fixed = fixed.replace(
	  /```html</g,
	  "```html\n<"
	);

	fixed = fixed.replace(
	  /```javascript(const|let|function)/g,
	  "```javascript\n$1"
	);

  fixed = fixed.replace(/\r/g, "");

  /*
    Nếu AI viết:
    ```html<!DOCTYPE
    => sửa thành:
    ```html
    <!DOCTYPE
  */

  fixed = fixed.replace(
    /```([a-zA-Z0-9+#-]*)([^\n])/g,
    "```$1\n$2"
  );

  /*
    Nếu AI chưa xuống dòng trước ```
  */

  fixed = fixed.replace(
    /([^\n])```/g,
    "$1\n```"
  );

  /*
    Nếu stream chưa đóng fence
    => tự đóng tạm thời
  */

  const fenceCount =
    (fixed.match(/```/g) || []).length;

  if (fenceCount % 2 !== 0) {
    fixed += "\n```";
  }

  return fixed;
}


function CodeBlock(props) {

  const {
    className,
    children
  } = props;

  const code =
    String(children || "")
      .replace(/\n$/, "");

  const [copied, setCopied] =
    useState(false);

  const isInline =
    !className;

  /* INLINE CODE */

  if (isInline) {
    return (
      <code className="inlineCode">
        {code}
      </code>
    );
  }

  async function copyCode() {

    try {

      await navigator.clipboard.writeText(
        code
      );

      setCopied(true);

      setTimeout(() => {
        setCopied(false);
      }, 1200);

    } catch {}

  }

  const lang =
    className
      ?.replace("language-", "")
      || "code";

  return (

    <div className="codeWrap">

      <div className="codeTop">

        <span className="codeLang">
          {lang.toUpperCase()}
        </span>

        <button
          className="codeBtn"
          type="button"
          onClick={copyCode}
        >
          {copied ? "Copied" : "Copy"}
        </button>

      </div>

      <pre className="codePre">

        <code className={className}>
          {code}
        </code>

      </pre>

    </div>

  );

}

function LinkRenderer({
href,
children
}){

const isFile =
href?.includes("/files/");

return(
<a
href={href}
target="_blank"
rel="noreferrer"
className={
isFile
?"fileLink"
:"link"
}
>
{isFile
?"⬇ Download file"
:children}
</a>
);
}

export default function MessageList({
messages=[],
loading=false
}){

return(
<section className="chatArea">

{messages.map(
(msg,index)=>{

const content =
msg.content || "";

const isImg =
content.startsWith("data:image") ||

(
  content.startsWith("http") && (

    content.includes("/files/img_") ||

    content.includes("/files/avatar_") ||

    content.includes(".png") ||

    content.includes(".jpg") ||

    content.includes(".jpeg") ||

    content.includes(".webp") ||

    content.includes("openaiusercontent")

  )
);



return(
<div
key={index}
className={`row ${msg.role}`}
>

<div
className={`bubble ${msg.role}`}
>

<div className="msgRole">
{msg.role==="user"
?"Bạn"
:"WorkAI"}
</div>

{isImg?(
<img
src={content}
className="chatImg"
/>
) : (

<ReactMarkdown
  remarkPlugins={[remarkGfm]}
  components={{
    code: CodeBlock,
    a: LinkRenderer
  }}
>
  {fixCodeBlock(content)}
</ReactMarkdown>

)}

</div>

</div>
);

}
)}

{loading&&(
<div className="row assistant">

<div className="bubble assistant typingBubble">

<div className="msgRole">
WorkAI
</div>

<div className="typingDots">
<span></span>
<span></span>
<span></span>
</div>

</div>

</div>
)}

</section>
);
}
