import { useState } from "react";
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
        "OTP sent"
      );

      setStep(2);

    } catch (err) {

      setMessage(
        err.response?.data?.message ||
        "Send OTP failed"
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
        "Password reset successful"
      );

      alert(
        "Password reset successful"
      );

    } catch (err) {

      setMessage(
        err.response?.data?.message ||
        "Reset password failed"
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
          boxShadow:
            "0 10px 30px rgba(0,0,0,0.1)",
        }}
      >

        <h1
          style={{
            marginBottom: 10,
            fontSize: 30,
            fontWeight: 700,
          }}
        >
          Forgot Password
        </h1>

        <p
          style={{
            color: "#666",
            marginBottom: 25,
          }}
        >
          WorkAI VN Account Recovery
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
                    ? "Sending..."
                    : "Send OTP"
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
                OTP Code
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
                New Password
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
                placeholder="New password"
                style={inputStyle}
              />

              <button
                type="submit"
                disabled={loading}
                style={buttonStyle}
              >
                {
                  loading
                    ? "Resetting..."
                    : "Reset Password"
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
