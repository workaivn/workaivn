import React,{
useState
} from "react";
import {
  renderMarkdown
} from "../utils/markdown";

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

{isImg ? (

  <img
    src={content}
    className="chatImg"
  />

) : (

  <div
    className={
      msg.streaming
        ? "markdown streaming"
        : "markdown"
    }
    dangerouslySetInnerHTML={{
      __html: renderMarkdown(content)
    }}
  />

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
