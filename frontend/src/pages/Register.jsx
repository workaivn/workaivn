// frontend/src/pages/Register.jsx

import React, {
  useState
} from "react";

const API =
  "https://api.workaivn.com/api";

export default function Register({
  setPage
}) {

  const [
    fullName,
    setFullName
  ] = useState("");

  const [
    username,
    setUsername
  ] = useState("");

  const [
    email,
    setEmail
  ] = useState("");

  const [
    password,
    setPassword
  ] = useState("");

  const [
    repassword,
    setRepassword
  ] = useState("");

  const [
    error,
    setError
  ] = useState("");

  const [
    loading,
    setLoading
  ] = useState(false);

  async function register() {

    try {

      setError("");

      if (
        !fullName.trim()
      ) {
        return setError(
          "Vui lòng nhập họ tên"
        );
      }

      if (
        !username.trim()
      ) {
        return setError(
          "Vui lòng nhập username"
        );
      }

      if (
        !email.trim()
      ) {
        return setError(
          "Vui lòng nhập email"
        );
      }

      if (
        password.length < 6
      ) {
        return setError(
          "Mật khẩu tối thiểu 6 ký tự"
        );
      }

      if (
        password !==
        repassword
      ) {
        return setError(
          "Mật khẩu không khớp"
        );
      }

      setLoading(true);

      const r =
        await fetch(
          API + "/register",
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json"
            },

            body:
              JSON.stringify({
                fullName,
                username,
                email,
                password
              })
          }
        );

      const d =
        await r.json();

      if (d.ok) {

        alert(
          "Đăng ký thành công"
        );

        setPage(
          "login"
        );

      } else {

        setError(
          d.error ||
          "Đăng ký thất bại"
        );

      }

    } catch {

      setError(
        "Không thể kết nối server"
      );

    } finally {

      setLoading(false);

    }
  }

  return (
    <div className="authWrap">

      <div className="authBox">

        <h1>
          Tạo tài khoản
        </h1>

        <p>
          Gia nhập WorkAI VN
        </p>

        <input
          placeholder="Họ và tên"
          value={fullName}
          onChange={(e)=>
            setFullName(
              e.target.value
            )
          }
        />

        <input
          placeholder="Username"
          value={username}
          onChange={(e)=>
            setUsername(
              e.target.value
            )
          }
        />

        <input
          placeholder="Email"
          value={email}
          onChange={(e)=>
            setEmail(
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
        />

        <input
          type="password"
          placeholder="Nhập lại mật khẩu"
          value={repassword}
          onChange={(e)=>
            setRepassword(
              e.target.value
            )
          }
        />

        {error && (
          <div className="errorBox">
            {error}
          </div>
        )}

        <button
          onClick={register}
          disabled={loading}
        >
          {loading
            ? "Đang tạo..."
            : "Tạo tài khoản"}
        </button>

        <span
          onClick={() =>
            setPage(
              "login"
            )
          }
        >
          Đã có tài khoản?
          Đăng nhập
        </span>

      </div>

    </div>
  );
}
