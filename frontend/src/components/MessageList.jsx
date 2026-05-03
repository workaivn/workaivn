import React,{
useState
} from "react";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

function CodeBlock({
inline,
className,
children
}){

const code =
String(children || "")
.replace(/\n$/,"");

const [copied,setCopied] =
useState(false);

/* inline code */
if(inline){
return(
<code className="inlineCode">
{code}
</code>
);
}

async function copyCode(){

try{
await navigator.clipboard.writeText(
code
);

setCopied(true);

setTimeout(()=>{
setCopied(false);
},1200);

}catch{}

}

const lang =
className
?.replace("language-","")
||"code";

return(
<div className="codeWrap">

<div className="codeTop">

<span className="codeLang">
{lang}
</span>

<button
className="codeBtn"
type="button"
onClick={copyCode}
>
{copied
?"Copied"
:"Copy"}
</button>

</div>

<pre>
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
content.startsWith("http") &&
(
content.includes(".png") ||
content.includes(".jpg") ||
content.includes(".jpeg") ||
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
):(
<ReactMarkdown
remarkPlugins={[
remarkGfm
]}
components={{
code:CodeBlock,
a:LinkRenderer
}}
>
{content}
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