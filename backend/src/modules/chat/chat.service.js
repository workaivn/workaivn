// backend/src/modules/chat/chat.service.js

import User from "../auth/auth.model.js";
import { askAI } from "../../services/aiRouter.js";
import Chat from "./chat.model.js";
import { runAgentLoop } from "../../agent/runAgentLoop.js";

/* =====================================
   SYSTEM PROMPTS (GIỮ NGUYÊN)
===================================== */

function getSystemPrompt(mode = "normal") {
  switch (mode) {
    case "sales":
      return `
Bạn là chuyên gia marketing Việt Nam.

Nhiệm vụ:
- Viết content bán hàng chuyển đổi cao
- Hook mạnh 3 giây đầu
- CTA rõ ràng
- Văn phong tự nhiên, dễ chốt đơn
- Hiểu thị trường Việt Nam

Khi phù hợp hãy tạo:
1. Caption ngắn
2. Caption dài
3. 5 headline
4. CTA mạnh
`;

    case "cv":
      return `
Bạn là chuyên gia HR tuyển dụng.

Nhiệm vụ:
- Tạo CV chuyên nghiệp
- Tối ưu ATS
- Viết cover letter
- Chuẩn phong cách doanh nghiệp
- Tư vấn phỏng vấn

Trả lời rõ ràng, thực chiến.
`;

    case "office":
      return `
Bạn là trợ lý văn phòng chuyên nghiệp.

Nhiệm vụ:
- Viết email chuyên nghiệp
- Soạn công văn
- Biên bản
- Báo giá
- Tin nhắn khách hàng

Ngắn gọn, lịch sự, hiệu quả.
`;

    case "summary":
      return `
Bạn là chuyên gia phân tích tài liệu.

Nhiệm vụ:
- Tóm tắt PDF / Word
- Trích ý chính
- Giải thích dễ hiểu
- Tạo checklist hành động
- So sánh nội dung

Trình bày bằng bullet points đẹp.
`;

    case "teacher":
      return `
Bạn là giáo viên giỏi.

Nhiệm vụ:
- Giải thích dễ hiểu
- Soạn giáo án
- Ra đề
- Chấm bài
- Dạy từng bước
`;

    case "law":
      return `
Bạn là trợ lý pháp lý phổ thông.

Nhiệm vụ:
- Soạn hợp đồng mẫu
- Đơn từ
- Văn bản cơ bản
- Giải thích đơn giản

Không khẳng định tư vấn pháp lý chính thức.
`;


case "cv_builder":
  return `
Bạn là chuyên gia tuyển dụng cao cấp.

Nhiệm vụ:
- Tạo CV chuẩn ATS
- Viết thành tựu có số liệu
- Chuyên nghiệp, hiện đại

Bố cục:
# THÔNG TIN
# TÓM TẮT
# KINH NGHIỆM
# KỸ NĂNG
# HỌC VẤN
# THÀNH TỰU
`;

case "cover_letter":
  return `
Bạn là HR manager.

Viết Cover Letter thuyết phục.

Yêu cầu:
- Cá nhân hóa theo công ty
- Ngắn gọn 250-350 từ
- Chuyên nghiệp
`;

case "cv_match":
  return `
Bạn là ATS scanner.

So sánh CV với JD.

Output:

# MATCH SCORE (%)
# ĐIỂM MẠNH
# THIẾU KỸ NĂNG
# NÊN SỬA NGAY
# TỪ KHÓA CẦN THÊM
`;

case "mock_interview":
  return `
Bạn là recruiter chuyên nghiệp.

Phỏng vấn từng câu một:

1. hỏi 1 câu
2. chờ user trả lời
3. chấm:
- Tự tin
- Logic
- Chuyên môn
4. hỏi tiếp
`;

case "file_summary":
return `
Bạn là chuyên gia phân tích tài liệu.

Tóm tắt file thành:

# TỔNG QUAN
# Ý CHÍNH
# KẾT LUẬN
# ĐỀ XUẤT

Ngắn gọn, chuyên nghiệp.
`;

case "file_keypoints":
return `
Bạn là chuyên gia bóc tách thông tin.

Trích 10 ý quan trọng nhất từ file.
Dạng bullet points rõ ràng.
`;

case "file_explain":
return `
Bạn là giáo viên giỏi.

Giải thích nội dung file thật dễ hiểu.
Đơn giản hóa thuật ngữ.
Có ví dụ nếu cần.
`;

case "file_checklist":
return `
Bạn là trợ lý công việc.

Từ file, tạo:

# CHECKLIST HÀNH ĐỘNG
1.
2.
3.

Ưu tiên việc quan trọng trước.
`;

case "patch":
  return `

Bạn là AI patch engine.

Nhiệm vụ:
- Chỉ trả về JSON patch
- Không giải thích dài dòng
- Không markdown
- Không text ngoài JSON

Format:

[
  {
    "file": "backend/src/example.js",
    "find": "old code",
    "replace": "new code"
  }
]

QUY TẮC:

- Chỉ patch đúng phần cần sửa
- Không invent code không tồn tại
- Không dump full source
- Output phải parse được bằng JSON.parse()
`;
    default:
      return `
Bạn là WorkAI VN.

Trợ lý AI thông minh dành cho người Việt.
Trả lời hữu ích, ngắn gọn, đúng trọng tâm.
`;
  }
}

/* =====================================
   BEAUTIFY OUTPUT
===================================== */

function postProcess(text, mode) {
  if (!text) return "Không có phản hồi.";

  let t = text.trim();

  if (
    mode === "sales" &&
    !t.includes("CTA")
  ) {
    t += "\n\n**CTA:** Inbox ngay để nhận ưu đãi hôm nay.";
  }

  return t;
}

/* =====================================
   SAVE CHAT
===================================== */

async function saveChat(
  userId,
  messages,
  answer,
  chatId,
  activeFiles = null
) {
  try {
    let doc = null;

    if (chatId) {
      doc = await Chat.findOne({
        _id: chatId,
        userId
      });
    }

    if (!doc) {
      doc = await Chat.create({
        userId,
        title:
          String(
            messages?.[0]?.content ||
            "New Chat"
          ).slice(0, 60),
        messages: []
      });
    }

    doc.messages.push(
	  ...messages,
	  {
		role: "assistant",
		content: answer
	  }
	);

	doc.updatedAt =
	  new Date();
	  
	if (activeFiles) {

	  doc.activeFiles =
		activeFiles;

	}
	await doc.save();

  } catch (err) {
    console.log(
      "SAVE CHAT ERROR:",
      err
    );
  }
}

export async function streamChat({
	  userId,
	  messages = [],
	  mode = "normal",
	  search = false,
	  res,
	  chatId = null
	}) {
	  try {

		const user =
		  await User.findById(
			userId
		  );

		const plan =
		  user?.plan ||
		  "free";

		const systemPrompt =
		  getSystemPrompt(
			mode
		  );

	   let finalMessages = [];
	   finalMessages.push({

	  role: "system",

	  content: systemPrompt

	});

	/* =========================
	   LOAD CHAT HISTORY
	========================= */

	let existingChat = null;

	let activeFilesText = "";

	if (chatId) {

	  existingChat =
		await Chat.findOne({
		  _id: chatId,
		  userId
		});

	  if (
		existingChat
		  ?.activeFiles
		  ?.length
	  ) {

		const latestFiles =
		  existingChat
			.activeFiles
			.slice(-5);

		activeFilesText =
		  latestFiles
			.map((f) => {

			  const latestUserMsg =
				messages?.[
				  messages.length - 1
				]?.content
				  ?.toLowerCase() || "";

			  const keywords =
			  latestUserMsg
				.toLowerCase()
				.replace(/[^\w\s]/g, " ")
				.split(/\s+/)
				.filter(Boolean);

			  const relevantChunks =
				  (f.chunks || [])

					.map(c => {

					  if (
						typeof c === "string"
					  ) {

						c = {
						  content: c,
						  type: "text",
						  name: "legacy"
						};

					  }

					  const haystack = `

				${c.name || ""}
				${c.type || ""}
				${c.content || ""}

				`
						.toLowerCase();

					  let score = 0;
					  if (
						  f.name
							?.toLowerCase()
							?.includes(
							  latestUserMsg
							)
						) {

						  score += 3000;

						}
					  
					  const fullQuery =
						  latestUserMsg
							.toLowerCase();

						if (
						  c.name &&
						  fullQuery.includes(
							c.name.toLowerCase()
						  )
						) {

						  score += 5000;

						}

					  keywords.forEach(k => {

					  if (
						c.name
						  ?.toLowerCase()
						  === k
					  ) {

						score += 50000;

					  }

					  if (
						c.name
						  ?.toLowerCase()
						  ?.includes(k)
					  ) {

						score += 200;

					  }

					  if (
						c.type
						  ?.toLowerCase()
						  ?.includes(k)
					  ) {

						score += 20;

					  }

					  if (
						  haystack.includes(k)
						) {

						  score += 20;

						} {

						score += 20;

					  }

					});

					  return {
						...c,
						score
					  };

					})

					.sort(
				  (a, b) =>
					b.score - a.score
				);

				console.log(
				  "TOP CHUNKS:",
				  JSON.stringify(

					relevantChunks
					  .slice(0, 3)

					  .map(x => ({

						file:
						  x.file,

						name:
						  x.name,

						type:
						  x.type,

						score:
						  x.score,

						preview:

						  String(
							x.content || ""
						  )
						  .replace(/\s+/g, " ")
						  .slice(0, 120)

					  })),

					null,
					2

				  )
				);

				const finalChunks =
				  relevantChunks
					.slice(

					  latestUserMsg.includes(
						"ở đâu"
					  )

						? 3

						: 8

					)
					.map(c => {

					  if (
						typeof c === "string"
					  ) {

						c = {
						  content: c,
						  type: "text",
						  name: "legacy"
						};

					  }

					  return `

						FILE:
						${c.file}

						TYPE:
						${c.type}

						FUNCTION:
						${c.name}

						CONTENT:
						${c.content}

						`;

					})
					.join("\n");
	
					 return `

						FILE: ${f.name}

						SUMMARY:
						${f.summary}

						CHUNKS:
						${finalChunks}

						`;

									})
									.join("\n");

	  }

		 if (
		  existingChat?.messages
			?.length
		) {

		  const recentHistory =

			existingChat.messages

			  /* chỉ lấy user msg */

			  .filter(
				m =>
				  m.role === "user"
			  )

			  /* lấy ít thôi */

			  .slice(-6)

			  /* limit size */

			  .map(m => ({

				role:
				  m.role,

				content:

				  String(
					m.content || ""
				  )
				  .slice(0, 2000)

			  }));

		  finalMessages.push(
			...recentHistory
		  );

		}

	}

	/* =========================
	   APPEND NEW MESSAGE
	========================= */

	if (
	  activeFilesText
	) {

	  finalMessages.push({

		role: "system",

		content: `

	IMPORTANT:

	- Nếu thấy exact function/class:
	  PHẢI quote đúng nội dung thật.
	- Không được đoán code không tồn tại.
	- Nếu function tồn tại:
	  phải nói rõ FILE + FUNCTION NAME.
	- Không được invent patch nếu chưa thấy code thật.

	QUAN TRỌNG:

	- Nếu user hỏi:
	  "ở đâu"
	  "nằm ở đâu"
	  "file nào"

	THÌ PHẢI trả lời:

	1. FILE NAME
	2. FUNCTION NAME
	3. Code snippet thật

	Không được trả lời chung chung.

	ACTIVE FILES:

	${activeFilesText}

	`

	  });

	}

	finalMessages.push(
	  ...messages
	);

	/* =========================
	   CLEAN INVALID
	========================= */

	finalMessages =
	  finalMessages
		.filter(
		  (m) =>
			m &&
			m.role &&
			m.content
		)
		.map((m) => ({

		  role: m.role,

		  content:
			String(
			  m.content
			)

		}));

	const cleanedMessages =
  finalMessages;

		if (
		  activeFilesText
		) {

		  cleanedMessages.push({

			role: "system",

			content: `

		IMPORTANT:

		- Nếu thấy exact function/class:
		  PHẢI quote đúng nội dung thật.
		- Không được đoán code không tồn tại.
		- Nếu function tồn tại:
		  phải nói rõ FILE + FUNCTION NAME.
		- Không được invent patch nếu chưa thấy code thật.

		QUAN TRỌNG:

		- Nếu user hỏi:
		  "ở đâu"
		  "nằm ở đâu"
		  "file nào"

		THÌ PHẢI trả lời:

		1. FILE NAME
		2. FUNCTION NAME
		3. Code snippet thật

		Không được trả lời chung chung.

		ACTIVE FILES:

		${activeFilesText}

		`

		  });

		}

		let answer = "";

		const latestUserMessage =
		  messages[
			messages.length - 1
		  ]?.content || "";

		const isAgentTask =

		  latestUserMessage
			.toLowerCase()
			.includes("fix")

		  ||

		  latestUserMessage
			.toLowerCase()
			.includes("sửa")

		  ||

		  latestUserMessage
			.toLowerCase()
			.includes("bug")

		  ||

		  latestUserMessage
			.toLowerCase()
			.includes("refactor");

		if (isAgentTask) {

		  const agentResult =
			await runAgentLoop({

			  messages:
				cleanedMessages,

			  plan

			});

		  answer = `

			${agentResult.history
			  ?.filter(
				(x) =>
				  x.type ===
				  "status"
			  )
			  ?.map(
				(x) => x.text
			  )
			  ?.join("\n")}

			`;

			if (
			  agentResult.patch
			) {

			  answer += `

			PATCH:

			${JSON.stringify(

			  agentResult.patch,

			  null,

			  2

			)}

			`;

			}

			answer += `

			${agentResult.final}

			`;

		} else {

		  answer =
			await askAI({

			  messages:
				cleanedMessages,

			  mode,

			  plan

			});

		}


    console.log("=== DEBUG CHAT ===");
	console.log("USER:", userId);
	console.log("ANSWER:", answer);
	console.log("==================");

     

    const final =
      postProcess(
        answer,
        mode
      );

    res.write(final);

    await saveChat(

	  userId,

	  messages,

	  final,

	  chatId,

	  existingChat
		? existingChat.activeFiles
		: undefined

	);

    res.end();

  } catch (err) {
    console.log(
      "CHAT ERROR:",
      err
    );

    res.write(
      "Đang quá tải, vui lòng thử lại."
    );

    res.end();
  }
}

/* =====================================
   HISTORY
===================================== */

export async function getChats(
  userId
) {
  return await Chat.find({
    userId
  })
    .sort({
      updatedAt: -1
    })
    .limit(50);
}

export async function getChat(
  id,
  userId
) {
  return await Chat.findOne({
    _id: id,
    userId
  });
}
