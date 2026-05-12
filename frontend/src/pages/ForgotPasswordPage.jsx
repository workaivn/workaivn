import React, {
  useState
} from "react";

import axios from "axios";

export default function ForgotPasswordPage() {

  const [step, setStep] =
    useState(1);

  const [email, setEmail] =
    useState("");

  const [otp, setOtp] =
    useState("");

  const [
    newPassword,
    setNewPassword
  ] = useState("");

  const [loading, setLoading] =
    useState(false);

  const [message, setMessage] =
    useState("");

  const API =
    "https://api.workaivn.com/api";

  async function handleSendOtp(e) {

    e.preventDefault();

    try {

      setLoading(true);

      setMessage("");

      const res =
        await axios.post(
          `${API}/forgot-password`,
          {
            email,
          }
        );

      setMessage(
        res.data.message ||
        "Đã gửi mã OTP"
      );

      setStep(2);

    } catch (err) {

      setMessage(
        err.response?.data?.message ||
        "Gửi OTP thất bại"
      );

    } finally {

      setLoading(false);

    }
  }

  async function handleResetPassword(e) {

    e.preventDefault();

    try {

      setLoading(true);

      setMessage("");

      const res =
        await axios.post(
          `${API}/reset-password`,
          {
            email,
            otp,
            newPassword,
          }
        );

      setMessage(
        res.data.message ||
        "Đổi mật khẩu thành công"
      );

      setTimeout(() => {

        window.location.href = "/";

      }, 1200);

    } catch (err) {

      setMessage(
        err.response?.data?.message ||
        "Đổi mật khẩu thất bại"
      );

    } finally {

      setLoading(false);

    }
  }

  return (

    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f3f4f6",
        padding: 20,
      }}
    >

      <div
		  style={{
			width: 420,
			background: "white",
			borderRadius: 16,
			padding: 30,
			position: "relative",
			boxShadow:
			  "0 10px 30px rgba(0,0,0,0.1)",
		  }}
		>
	  
	  <button
		  onClick={() => window.location.href = "/"}
		  style={{
			position: "absolute",
			top: 35,
			right: 20,
			border: "none",
			background: "transparent",
			cursor: "pointer",
			fontSize: 14,
			color: "#555",
			fontWeight: 600,
			padding: "6px 10px",
			borderRadius: 8,
			transition: "0.2s",
		  }}
		  onMouseOver={(e) => {
			e.target.style.background = "#f3f4f6";
			e.target.style.color = "#000";
		  }}
		  onMouseOut={(e) => {
			e.target.style.background = "transparent";
			e.target.style.color = "#555";
		  }}
		>
		  ← Quay lại
	</button>

        <h1
          style={{
            marginBottom: 10,
            fontSize: 30,
            fontWeight: 700,
          }}
        >
          Quên mật khẩu
        </h1>

        <p
          style={{
            color: "#666",
            marginBottom: 25,
          }}
        >
          Khôi phục tài khoản WorkAI VN
        </p>

        {
          step === 1 && (

            <form
              onSubmit={handleSendOtp}
            >

              <label>
                Email
              </label>

              <input
                type="email"
                value={email}
                onChange={(e)=>
                  setEmail(
                    e.target.value
                  )
                }
                required
                placeholder="your@email.com"
                style={inputStyle}
              />

              <button
                type="submit"
                disabled={loading}
                style={buttonStyle}
              >
                {
                  loading
                    ? "Đang gửi..."
                    : "Gửi mã OTP"
                }
              </button>

            </form>
          )
        }

        {
          step === 2 && (

            <form
              onSubmit={
                handleResetPassword
              }
            >

              <label>
                Mã OTP
              </label>

              <input
                type="text"
                value={otp}
                onChange={(e)=>
                  setOtp(
                    e.target.value
                  )
                }
                required
                placeholder="123456"
                style={inputStyle}
              />

              <label>
                Mật khẩu mới
              </label>

              <input
                type="password"
                value={newPassword}
                onChange={(e)=>
                  setNewPassword(
                    e.target.value
                  )
                }
                required
                placeholder="Nhập mật khẩu mới"
                style={inputStyle}
              />

              <button
                type="submit"
                disabled={loading}
                style={buttonStyle}
              >
                {
                  loading
                    ? "Đang đổi mật khẩu..."
                    : "Đổi mật khẩu"
                }
              </button>

            </form>
          )
        }

        {
          message && (
            <div
              style={{
                marginTop: 20,
                padding: 12,
                borderRadius: 10,
                background: "#f3f4f6",
                color: "#111",
              }}
            >
              {message}
            </div>
          )
        }

      </div>

    </div>
  );
}

const inputStyle = {
  width: "100%",
  padding: 14,
  marginTop: 8,
  marginBottom: 18,
  borderRadius: 10,
  border: "1px solid #ddd",
  fontSize: 16,
  boxSizing: "border-box",
};

const buttonStyle = {
  width: "100%",
  padding: 14,
  borderRadius: 10,
  border: "none",
  background: "black",
  color: "white",
  fontSize: 16,
  cursor: "pointer",
  fontWeight: 600,
};
