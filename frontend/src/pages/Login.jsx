import React, {
  useState
} from "react";

const API =
  "https://api.workaivn.com/api";

const ADMIN_EMAIL =
  import.meta.env
    .VITE_ADMIN_EMAIL ||
  "";

export default function Login({
  setPage
}) {
  const [
    email,
    setEmail
  ] = useState("");

  const [
    password,
    setPassword
  ] = useState("");

  const [
    error,
    setError
  ] = useState("");

  const [
    loading,
    setLoading
  ] = useState(false);

  async function login() {
    try {
      setLoading(true);
      setError("");

      const r =
        await fetch(
          API +
            "/login",
          {
            method:
              "POST",
            headers: {
              "Content-Type":
                "application/json"
            },
            body: JSON.stringify(
              {
                email,
                password
              }
            )
          }
        );

      const d =
        await r.json();

      if (d.token) {
        localStorage.setItem(
          "token",
          d.token
        );

        const mail =
          String(
            email || ""
          )
            .trim()
            .toLowerCase();

        const adminMail =
          String(
            ADMIN_EMAIL
          )
            .trim()
            .toLowerCase();

        if (
          mail ===
          adminMail
        ) {
          window.location.href =
            "/admin";
          return;
        }

        location.reload();

      } else {
        setError(
          "Sai tài khoản hoặc mật khẩu"
        );
      }

    } catch {
      setError(
        "Không thể kết nối máy chủ"
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="authWrap">
      <div className="authBox">

        <h1>
          WorkAI VN
        </h1>

        <p>
          Đăng nhập để tiếp tục
        </p>

        <input
          placeholder="Email"
          value={email}
          onChange={(e) =>
            setEmail(
              e.target.value
            )
          }
        />

        <input
          type="password"
          placeholder="Mật khẩu"
          value={password}
          onChange={(e) =>
            setPassword(
              e.target.value
            )
          }
          onKeyDown={(e) => {
            if (
              e.key ===
              "Enter"
            ) {
              login();
            }
          }}
        />

        {error && (
          <div className="errorBox">
            {error}
          </div>
        )}

        <button
          onClick={login}
          disabled={loading}
        >
          {loading
            ? "Đang đăng nhập..."
            : "Đăng nhập"}
        </button>

        <span
          onClick={() =>
            setPage(
              "register"
            )
          }
        >
          Chưa có tài khoản?
          Tạo ngay
        </span>

      </div>
    </div>
  );
}