import React, {
  useState
} from "react";
import "./../landing.css";

export default function Landing() {
  const [faqOpen, setFaqOpen] =
    useState(1);

  const APP =
    "https://app.workaivn.com";

  function go(path = "") {
    window.location.href =
      APP + path;
  }

  function scrollToId(id) {
    document
      .getElementById(id)
      ?.scrollIntoView({
        behavior:
          "smooth"
      });
  }

  function toggleFaq(id) {
    setFaqOpen(
      faqOpen === id
        ? 0
        : id
    );
  }

  return (
    <div className="landing">

      {/* NAVBAR */}
      <header className="landingNav">

        <div className="navLeft">
          <img
            src="/logo.png"
            className="landingLogo"
          />

          <div>
            <div className="brandTitle">
              WorkAI VN
            </div>

            <div className="brandMini">
              AI for everyday work
            </div>
          </div>
        </div>

        <div className="navRight">

          <button
            className="navGhost"
            onClick={() =>
              go("/login")
            }
          >
            Đăng nhập
          </button>

          <button
            className="navPrimary"
            onClick={() =>
              go("/register")
            }
          >
            Dùng miễn phí
          </button>

        </div>

      </header>

      {/* HERO */}
      <section className="hero heroUltra">

        <div className="heroGlow"></div>

        <div className="heroLeft">

          <div className="heroBadge">
            🚀 AI Productivity Platform for Vietnam
          </div>

          <h1 className="heroTitleBig">
            Làm việc nhanh hơn với
            <span>
              {" "}
              WorkAI VN
            </span>
          </h1>

          <p className="heroDescBig">
            Chat AI, đọc PDF,
            tạo ảnh, viết nội dung
            và xử lý công việc
            mỗi ngày trong vài giây.
          </p>

          <div className="heroActions">

            <button
              className="heroPrimary"
              onClick={() =>
                go("/register")
              }
            >
              Dùng miễn phí
            </button>

            <button
              className="heroGhost"
              onClick={() =>
                scrollToId(
                  "pricing"
                )
              }
            >
              Xem bảng giá
            </button>

          </div>

          <div className="heroTrust">

            <div>
              <strong>
                10K+
              </strong>
              <span>
                Lượt hỏi
              </span>
            </div>

            <div>
              <strong>
                24/7
              </strong>
              <span>
                Online
              </span>
            </div>

            <div>
              <strong>
                99%
              </strong>
              <span>
                Hài lòng
              </span>
            </div>

          </div>

        </div>

        <div className="heroRight">

          <div className="heroCardMain">

            <div className="mockTop">
              <span></span>
              <span></span>
              <span></span>
            </div>

            <div className="heroMessages">

              <div className="heroMsg user">
                Viết email xin báo giá chuyên nghiệp
              </div>

              <div className="heroMsg ai">
                Đã hoàn tất trong 3 giây ✨
              </div>

              <div className="heroMsg user">
                Tóm tắt file PDF 120 trang
              </div>

              <div className="heroMsg ai">
                Hoàn tất. 5 ý chính đã sẵn sàng.
              </div>

            </div>

          </div>

          <div className="floatCard one">
            ⚡ Nhanh hơn 10x
          </div>

          <div className="floatCard two">
            📄 PDF AI
          </div>

          <div className="floatCard three">
            🎨 Image AI
          </div>

        </div>

      </section>

      {/* FEATURES */}
      <section
        id="features"
        className="features"
      >

        <div className="sectionTitle">
          Tính năng nổi bật
        </div>

        <div className="featureGrid">

          <div className="featureCard">
            <div className="icon">
              📄
            </div>
            <h3>
              Tóm tắt PDF
            </h3>
            <p>
              Upload tài liệu và nhận
              bản tóm tắt nhanh chóng.
            </p>
          </div>

          <div className="featureCard">
            <div className="icon">
              📝
            </div>
            <h3>
              Soạn văn bản
            </h3>
            <p>
              Hợp đồng, email,
              công văn, CV...
            </p>
          </div>

          <div className="featureCard">
            <div className="icon">
              💬
            </div>
            <h3>
              Chat AI
            </h3>
            <p>
              Hỏi đáp thông minh,
              tìm ý tưởng tức thì.
            </p>
          </div>

          <div className="featureCard">
            <div className="icon">
              🎨
            </div>
            <h3>
              Tạo ảnh AI
            </h3>
            <p>
              Tạo hình ảnh đẹp chỉ từ
              mô tả văn bản.
            </p>
          </div>

        </div>

      </section>

      {/* SOCIAL PROOF */}
      <section className="proofSection">

        <div className="sectionTitle">
          Được tin dùng mỗi ngày
        </div>

        <div className="proofGrid">

          <div className="proofCard">
            ⭐⭐⭐⭐⭐
            <p>
              Viết email và proposal cực nhanh.
            </p>
            <span>
              Anh Minh - Sales
            </span>
          </div>

          <div className="proofCard">
            ⭐⭐⭐⭐⭐
            <p>
              Tóm tắt PDF rất hữu ích cho công việc.
            </p>
            <span>
              Chị Lan - Văn phòng
            </span>
          </div>

          <div className="proofCard">
            ⭐⭐⭐⭐⭐
            <p>
              Dùng mỗi ngày để brainstorm content.
            </p>
            <span>
              Tuấn - Marketing
            </span>
          </div>

        </div>

      </section>

      {/* FAQ */}
      <section className="faqSection">

        <div className="sectionTitle">
          Câu hỏi thường gặp
        </div>

        <div className="faqWrap">

          <div
            className="faqItem"
            onClick={() =>
              toggleFaq(1)
            }
          >
            <h4>
              Có dùng miễn phí được không?
            </h4>

            {faqOpen === 1 && (
              <p>
                Có. Bạn được dùng gói Free mỗi ngày.
              </p>
            )}
          </div>

          <div
            className="faqItem"
            onClick={() =>
              toggleFaq(2)
            }
          >
            <h4>
              Pro có gì hơn?
            </h4>

            {faqOpen === 2 && (
              <p>
                Nhiều lượt chat hơn, AI mạnh hơn,
                upload file nhiều hơn.
              </p>
            )}
          </div>

          <div
            className="faqItem"
            onClick={() =>
              toggleFaq(3)
            }
          >
            <h4>
              Có phù hợp người Việt?
            </h4>

            {faqOpen === 3 && (
              <p>
                Có. Tối ưu cho nhu cầu công việc tại Việt Nam.
              </p>
            )}
          </div>

        </div>

      </section>

      {/* PRICING */}
      <section
  id="pricing"
  className="pricing"
>

  <div className="sectionTitle">
    Gói dịch vụ
  </div>

  <div className="priceGrid">

    {/* FREE */}
    <div className="priceCard">

      <h3>
        Free
      </h3>

      <div className="priceValue">
        0đ
      </div>

      <div className="priceSub">
        Dùng thử miễn phí
      </div>

      <ul className="priceList">
        <li>
          ✔ 10 chat / ngày
        </li>
        <li>
          ✔ 3 file / ngày
        </li>
        <li>
          ✔ 2 ảnh / ngày
        </li>
        <li>
          ✔ Công cụ cơ bản
        </li>
      </ul>

      <button
        className="priceBtn"
        onClick={() =>
          go("/register")
        }
      >
        Bắt đầu
      </button>

    </div>


    {/* PRO */}
    <div className="priceCard priceHot">

      <div className="hotBadge">
        PHỔ BIẾN NHẤT
      </div>

      <h3>
        Pro
      </h3>

      <div className="priceValue">
        99k
      </div>

      <div className="priceSub">
        / tháng
      </div>

      <ul className="priceList">
        <li>
          ✔ 200 chat / ngày
        </li>
        <li>
          ✔ 30 file / ngày
        </li>
        <li>
          ✔ 20 ảnh / ngày
        </li>
        <li>
          ✔ AI mạnh hơn
        </li>
        <li>
          ✔ Ưu tiên tốc độ
        </li>
      </ul>

      <button
        className="priceBtn"
        onClick={() =>
          go("/")
        }
      >
        Nâng cấp
      </button>

    </div>


    {/* BUSINESS */}
    <div className="priceCard">

	  <h3>
		Business
	  </h3>

	  <div className="priceValue">
		499k
	  </div>

	  <div className="priceSub">
		/ tháng
	  </div>

	  <ul className="priceList">
		<li>
		  ✔ Không giới hạn
		</li>
		<li>
		  ✔ Team usage
		</li>
		<li>
		  ✔ Tốc độ cao nhất
		</li>
		<li>
		  ✔ Ưu tiên hỗ trợ
		</li>
		<li>
		  ✔ Dùng cho doanh nghiệp
		</li>
	  </ul>

	  <button
		className="priceBtn"
		onClick={() =>
		  go("/")
		}
	  >
		Nâng cấp
	  </button>

	</div>

  </div>

</section>

      {/* CTA */}
      <section className="cta">

        <h2>
          Bắt đầu miễn phí hôm nay
        </h2>

        <p>
          Trải nghiệm AI cho công việc
          người Việt.
        </p>

        <button
          onClick={() =>
            go("/register")
          }
        >
          Vào ứng dụng
        </button>

      </section>

      <footer className="footer">
        © 2026 WorkAI VN
      </footer>

    </div>
  );
}