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

const imageSrc =
  msg.image ||
  (
    typeof content === "string"
      ? content
      : ""
  );

const isImg =
  imageSrc.startsWith("data:image") ||

  (
    imageSrc.startsWith("http") && (

      imageSrc.includes("/files/img_") ||

      imageSrc.includes("/files/avatar_") ||

      imageSrc.includes(".png") ||

      imageSrc.includes(".jpg") ||

      imageSrc.includes(".jpeg") ||

      imageSrc.includes(".webp") ||

      imageSrc.includes("openaiusercontent")

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
    src={imageSrc}
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
