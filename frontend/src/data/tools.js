// src/data/tools.js

export const tools = [
  {
    category: "HR",
    items: [
      {
        icon: "👔",
        label: "Viết JD tuyển dụng",
        desc: "Tạo mô tả công việc chuyên nghiệp",
        prompt:
          "Hãy viết JD tuyển dụng chuyên nghiệp bằng tiếng Việt, rõ yêu cầu, quyền lợi và KPI.",
        mode: "normal"
      },
      {
        icon: "📄",
        label: "Sàng lọc CV",
        desc: "Đánh giá CV theo vị trí",
        prompt:
          "Hãy đánh giá CV này theo vị trí ứng tuyển, nêu điểm mạnh, điểm yếu và mức phù hợp.",
        mode: "normal"
      },
      {
        icon: "🎤",
        label: "Câu hỏi phỏng vấn",
        desc: "Tạo bộ câu hỏi tuyển dụng",
        prompt:
          "Hãy tạo bộ câu hỏi phỏng vấn chuyên sâu cho vị trí này, chia theo kỹ năng và thái độ.",
        mode: "normal"
      }
    ]
  },

  {
    category: "Sales & Marketing",
    items: [
      {
        icon: "💰",
        label: "Viết báo giá",
        desc: "Mẫu báo giá chuyên nghiệp",
        prompt:
          "Hãy tạo báo giá chuyên nghiệp bằng tiếng Việt, rõ hạng mục, giá trị và CTA chốt sale.",
        mode: "normal"
      },
      {
        icon: "📧",
        label: "Email follow-up",
        desc: "Chăm sóc khách hàng",
        prompt:
          "Hãy viết email follow-up khách hàng lịch sự, tăng tỷ lệ phản hồi.",
        mode: "normal"
      },
      {
        icon: "📣",
        label: "Content bán hàng",
        desc: "Bài đăng Facebook/Zalo",
        prompt:
          "Hãy viết content bán hàng thu hút, có hook mạnh, CTA tốt và phù hợp khách hàng Việt Nam.",
        mode: "normal"
      }
    ]
  },

  {
    category: "Office",
    items: [
      {
        icon: "📕",
        label: "Tóm tắt PDF",
        desc: "Rút gọn tài liệu dài",
        prompt:
          "Hãy tóm tắt file PDF này ngắn gọn, dễ hiểu, nêu điểm chính và hành động cần làm.",
        mode: "file_summary"
      },
      {
        icon: "📝",
        label: "Soạn công văn",
        desc: "Văn bản hành chính",
        prompt:
          "Hãy soạn công văn hành chính chuẩn chỉnh, trang trọng, rõ mục đích và nội dung.",
        mode: "normal"
      },
      {
        icon: "📌",
        label: "Biên bản họp",
        desc: "Tạo minutes meeting",
        prompt:
          "Hãy viết biên bản họp chuyên nghiệp gồm mục tiêu, nội dung trao đổi, quyết định và next steps.",
        mode: "normal"
      }
    ]
  },

  {
    category: "Finance",
    items: [
      {
        icon: "📊",
        label: "Phân tích Excel",
        desc: "Insight dữ liệu doanh thu",
        prompt:
          "Hãy phân tích file Excel này, tìm insight quan trọng, bất thường và đề xuất hành động.",
        mode: "file_summary"
      },
      {
        icon: "💵",
        label: "Báo cáo doanh thu",
        desc: "Tổng hợp nhanh",
        prompt:
          "Hãy tạo báo cáo doanh thu ngắn gọn, rõ xu hướng tăng giảm và nguyên nhân chính.",
        mode: "file_summary"
      },
      {
        icon: "🧮",
        label: "Kiểm tra bảng lương",
        desc: "Soát lỗi payroll",
        prompt:
          "Hãy kiểm tra file bảng lương này, tìm lỗi sai, bất thường và rủi ro.",
        mode: "file_summary"
      }
    ]
  }
];