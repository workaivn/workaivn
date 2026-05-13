// backend/src/modules/chat/chat.service.js

import User from "../auth/auth.model.js";
import { askAI } from "../../services/aiRouter.js";
import Chat from "./chat.model.js";

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
  chatId
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

    doc.messages = [
      ...messages,
      {
        role: "assistant",
        content: answer
      }
    ];

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

    const userText =
      messages
        ?.map(
          (m) =>
            m.content
        )
        .join("\n") ||
      "";

    const prompt = `
${systemPrompt}

${userText}
`;

    const answer =
      await askAI({
        prompt,
        mode,
        plan
      });


     console.log("=== DEBUG CHAT ===");
console.log("USER:", userId);
console.log("PROMPT:", prompt);
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
      chatId
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
