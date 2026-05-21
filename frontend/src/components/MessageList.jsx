import React,{
useState
} from "react";
import {
  renderMarkdown
} from "../utils/markdown";

function extractPatch(content) {

  try {

    const match =
      content.match(
        /\[\s*\{[\s\S]*("file"|"path")[\s\S]*"find"[\s\S]*"replace"[\s\S]*\}\s*\]/m
      );

    if (!match) {
      return null;
    }

    const parsed =
      JSON.parse(match[0]);

    if (!Array.isArray(parsed)) {
      return null;
    }

    return parsed;

  } catch {

    return null;

  }

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
  typeof msg.content === "string"
    ? msg.content
    : "";

const patches =
  extractPatch(content);

const hasPatch =
  Array.isArray(patches) &&
  patches.length > 0;

const imageSrc =
  typeof msg.image === "string"
    ? msg.image
    : "";

const isImg =
  !!imageSrc &&
  (
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

{isImg && (

  <img
    src={imageSrc}
    className="chatImg"
    alt=""
	 style={{
		marginBottom: "12px"
	  }}
  />

)}

{content && (

  <>

    {hasPatch && (

	  <div className="patchView">

		{patches.map((p,i)=>(

		  <div
			key={i}
			className="patchItem"
		  >

			<div className="patchFile">

			  📄 File:
			  {" "}
			  {p.file || p.path}

			</div>

			<div className="patchTitle">
			  TÌM ĐOẠN NÀY:
			</div>

			<pre className="patchCode">
			  {p.find}
			</pre>

			<div className="patchTitle">
			  THAY THÀNH:
			</div>

			<pre className="patchCode">
			  {p.replace}
			</pre>

		  </div>

		))}

	  </div>

	)}

    {!hasPatch && (

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

  </>

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
