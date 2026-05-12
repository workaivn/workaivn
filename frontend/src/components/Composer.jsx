import React,{
useEffect,
useRef,
useState
} from "react";

export default function Composer({
text,
setText,
send,
search,
setSearch,
loading
}){

const fileRef=useRef(null);
const textareaRef=useRef(null);

const [previews, setPreviews] = useState([]);
const [dragging,setDragging]=useState(false);

useEffect(()=>{
if(!loading){
textareaRef.current?.focus();
}
},[loading]);

async function submit(){

  if(loading) return;

  const currentFiles =
    previews.map(
      x => x.file
    );

  /* clear ngay khi gửi */

  setPreviews([]);

  if(fileRef.current){
    fileRef.current.value="";
  }

  const ok =
    await send(currentFiles);

  if(ok){

    if(textareaRef.current){

      textareaRef.current.style.height =
        "52px";

      textareaRef.current.focus();

    }

  }

}

function autoResize(el){

el.style.height="52px";

const h =
Math.min(
el.scrollHeight,
240
);

el.style.height =
h + "px";

}

function onKeyDown(e){

if(
e.key==="Enter" &&
!e.shiftKey
){

e.preventDefault();

if(
text.trim() ||
previews.length
){
submit();
}

}

}

function handleFile(files){

  const list =
    Array.from(files || []);

  if(!list.length) return;

  const next = [];

  list.forEach(file=>{

    /* IMAGE */

    if(
      file.type.startsWith(
        "image/"
      )
    ){

      const reader =
        new FileReader();

      reader.onload=()=>{

        setPreviews(prev=>[
          ...prev,
          {
            type:"image",
            file,
            name:file.name,
            data:reader.result
          }
        ]);

      };

      reader.readAsDataURL(file);

      return;
    }

    /* NORMAL FILE */

    next.push({
      type:"file",
      file,
      name:file.name
    });

  });

  if(next.length){

    setPreviews(prev=>[
      ...prev,
      ...next
    ]);

  }

}

function handlePaste(e){

  const items =
    Array.from(
      e.clipboardData.items || []
    );

  const images =
    items
      .filter(x=>
        x.type.includes("image")
      )
      .map((x,i)=>{

	  const file =
		x.getAsFile();

	  if(
		file &&
		!file.name
	  ){

		return new File(
		  [file],
		  `paste-${Date.now()}-${i}.png`,
		  {
			type:file.type
		  }
		);

	  }

	  return file;

	});

  if(images.length){

    handleFile(images);

  }

}


return(
<div
className={`composerWrap ${
dragging?"dragging":""
}`}
onDragOver={e=>{
e.preventDefault();
setDragging(true);
}}
onDragLeave={()=>
setDragging(false)
}
onDrop={e=>{
e.preventDefault();
setDragging(false);

handleFile(
  e.dataTransfer.files
);

}}
>

<div className="composer premiumComposer">

<button
type="button"
className="iconBtn"
disabled={loading}
onClick={()=>
fileRef.current?.click()
}
title="Đính kèm file"
>
📎
</button>

<input
hidden
ref={fileRef}
multiple
type="file"
accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.png,.jpg,.jpeg,.webp,.py,.js,.jsx,.ts,.tsx,.html,.css,.json,.sql,.java,.php,.cpp,.c,.cs,.go,.rs,.xml,.yaml,.yml,.env,.log"
onChange={e=>
handleFile(
  e.target.files
)
}
/>

<button
type="button"
className={`iconBtn ${
search?"active":""
}`}
disabled={loading}
onClick={()=>
setSearch(!search)
}
title="Tìm web"
>
🌐
</button>

<div className="inputArea">

{previews.length > 0 && (

  <div className="multiPreview">

    {previews.map(
      (preview,i)=>(

      <div
        key={i}
        className="filePreview"
      >

        {preview.type==="image"?(

          <img
			alt=""
            src={preview.data}
            className="miniPreview"
          />

        ):(
          <>📄</>
        )}

        <span>
          {preview.name}
        </span>

        <button
          className="removePreview"
          type="button"
          onClick={()=>{

            setPreviews(prev=>
              prev.filter(
                (_,idx)=>
                  idx!==i
              )
            );

          }}
        >
          ✕
        </button>

      </div>

    ))}

  </div>

)}

<textarea
onPaste={handlePaste}
ref={textareaRef}
rows="1"
value={text}
disabled={loading}
placeholder="Nhắn WorkAI VN..."
onChange={e=>{
setText(e.target.value);
autoResize(e.target);
}}
onKeyDown={onKeyDown}
/>

</div>

<button
type="button"
className="sendBtn glowBtn"
disabled={
loading ||
(!text.trim()&&!previews.length)
}
onClick={submit}
>
{loading?"...":"➜"}
</button>

</div>

</div>
);
}