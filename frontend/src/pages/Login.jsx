// frontend/src/pages/Login.jsx

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
    account,
    setAccount
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
          API + "/login",
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json"
            },

            body:
              JSON.stringify({
                account,
                password
              })
          }
        );

      const d =
        await r.json();

      if (d.token) {

        localStorage.setItem(
          "token",
          d.token
        );

        localStorage.setItem(
          "user",
          JSON.stringify(
            d.user
          )
        );

        const mail =
          String(
            d.user?.email || ""
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
          d.error ||
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
          placeholder="Email hoặc Username"
          value={account}
          onChange={(e)=>
            setAccount(
              e.target.value
            )
          }
        />

        <input
          type="password"
          placeholder="Mật khẩu"
          value={password}
          onChange={(e)=>
            setPassword(
              e.target.value
            )
          }
          onKeyDown={(e)=>{
            if(
              e.key ===
              "Enter"
            ){
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

		<div
		  style={{
			marginTop: 18,
			paddingLeft: 4,
			paddingRight: 4,
			display: "flex",
			justifyContent:
			  "space-between",
			alignItems: "center",
			fontSize: 15,
			color: "#555",
		  }}
		>

		  <span
			onClick={() =>
			  setPage("register")
			}
			style={{
			  cursor: "pointer",
			  lineHeight: 1,
			}}
		  >
			Chưa có tài khoản?
			Tạo ngay
		  </span>

		  <span
			onClick={() => {
			  window.location.href =
				"/forgot-password";
			}}
			style={{
			  cursor: "pointer",
			  lineHeight: 1,
			}}
		  >
			Quên mật khẩu?
		  </span>

		</div>



      </div>

    </div>
  );
}
