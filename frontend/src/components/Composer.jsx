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

const [preview,setPreview]=useState(null);
const [dragging,setDragging]=useState(false);

useEffect(()=>{
if(!loading){
textareaRef.current?.focus();
}
},[loading]);

async function submit(){

if(loading) return;

const currentFile =
preview?.file || null;

/* clear ngay khi gửi */
setPreview(null);

if(fileRef.current){
fileRef.current.value="";
}

const ok =
await send(currentFile);

if(ok){

if(textareaRef.current){
textareaRef.current.style.height="52px";
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
preview
){
submit();
}

}

}

function handleFile(file){

if(!file) return;

if(
file.type.startsWith("image/")
){

const reader =
new FileReader();

reader.onload=()=>{

setPreview({
type:"image",
file,
name:file.name,
data:reader.result
});

};

reader.readAsDataURL(file);
return;
}

setPreview({
type:"file",
file,
name:file.name
});

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

const file =
e.dataTransfer.files?.[0];

if(file){
handleFile(file);
}
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
type="file"
accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.png,.jpg,.jpeg,.webp,.py,.js,.jsx,.ts,.tsx,.html,.css,.json,.sql,.java,.php,.cpp,.c,.cs,.go,.rs,.xml,.yaml,.yml,.env,.log"
onChange={e=>
handleFile(
e.target.files?.[0]
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

{preview&&(
<div className="filePreview">

{preview.type==="image"?(
<img
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
onClick={()=>
setPreview(null)
}
>
✕
</button>

</div>
)}

<textarea
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
(!text.trim()&&!preview)
}
onClick={submit}
>
{loading?"...":"➜"}
</button>

</div>

</div>
);
}