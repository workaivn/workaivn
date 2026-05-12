import React, {
  useEffect,
  useState
} from "react";

import { apiGet } from "../services/api";

export default function Profile() {

  const [
    user,
    setUser
  ] = useState(null);
  const [ uploadingAvatar, setUploadingAvatar ] = useState(false);
  const [ usage, setUsage ] = useState(null);
  const [ billings, setBillings ] = useState([]);

  const [
    loading,
    setLoading
  ] = useState(true);

  const [
    saving,
    setSaving
  ] = useState(false);

  const [
    msg,
    setMsg
  ] = useState("");

  const [
    error,
    setError
  ] = useState("");

  const [
    passwordBox,
    setPasswordBox
  ] = useState({
    oldPassword: "",
    newPassword: "",
    rePassword: ""
  });

  async function loadMe() {

    try {

      setLoading(true);

      const r =
        await apiGet("/me");

      const d =
        await r.json();

      setUser(d);

    } catch {

      setUser(null);

    } finally {

      setLoading(false);

    }
  }
  
  
  async function loadUsage() { try { const r = await apiGet("/usage"); const d = await r.json(); setUsage(d); } catch { setUsage(null); } }
  async function loadBillings() { try { const r = await apiGet( "/my/billings" ); const d = await r.json(); setBillings( Array.isArray(d) ? d : [] ); } catch { setBillings([]); } }

  async function saveProfile() {

    try {

      setSaving(true);
      setMsg("");
      setError("");

      const r =
        await fetch(
          "https://api.workaivn.com/api/me",
          {
            method: "PUT",

            headers: {
              "Content-Type":
                "application/json",

              authorization:
                localStorage.getItem(
                  "token"
                )
            },

            body:
              JSON.stringify({
                fullName:
                  user.fullName,

                phone:
                  user.phone,

                avatar:
                  user.avatar
              })
          }
        );

      const d =
        await r.json();

      if (d.ok) {

        setMsg(
          "Đã lưu thông tin"
        );

      } else {

        setError(
          d.error ||
          "Lưu thất bại"
        );

      }

    } catch {

      setError(
        "Không kết nối server"
      );

    } finally {

      setSaving(false);

    }
  }

  async function changePassword() {

    try {

      setMsg("");
      setError("");

      if (
        passwordBox.newPassword !==
        passwordBox.rePassword
      ) {
        return setError(
          "Mật khẩu không khớp"
        );
      }

      const r =
        await fetch(
          "https://api.workaivn.com/api/me/password",
          {
            method: "PUT",

            headers: {
              "Content-Type":
                "application/json",

              authorization:
                localStorage.getItem(
                  "token"
                )
            },

            body:
              JSON.stringify({
                oldPassword:
                  passwordBox.oldPassword,

                newPassword:
                  passwordBox.newPassword
              })
          }
        );

      const d =
        await r.json();

      if (d.ok) {

        setMsg(
          "Đổi mật khẩu thành công"
        );

        setPasswordBox({
          oldPassword: "",
          newPassword: "",
          rePassword: ""
        });

      } else {

        setError(
          d.error ||
          "Đổi mật khẩu thất bại"
        );

      }

    } catch {

      setError(
        "Không kết nối server"
      );

    }
  }
  
  
  
async function uploadAvatar(file) {

  try {

    if (!file) return;

    setUploadingAvatar(true);

    const form =
      new FormData();

    form.append(
      "file",
      file
    );

    const r =
      await fetch(
        "https://api.workaivn.com/api/upload-avatar",
        {
          method: "POST",

          headers: {
            authorization:
              localStorage.getItem(
                "token"
              )
          },

          body: form
        }
      );

    const d =
      await r.json();

    if (d.ok) {

      setUser({
        ...user,
        avatar:
          d.avatar
      });

      setMsg(
        "Avatar updated"
      );

    } else {

      setError(
        d.error ||
        "Upload fail"
      );

    }

  } catch {

    setError(
      "Upload fail"
    );

  } finally {

    setUploadingAvatar(false);

  }
}



  useEffect(() => { loadMe(); loadUsage(); loadBillings(); }, []);

  if (loading) {
    return (
      <div className="profilePage">
        Loading...
      </div>
    );
  }

  if (!user) {
    return (
      <div className="profilePage">
        Không tải được profile
      </div>
    );
  }

  return (
    <div className="profilePage">

      <div className="profileBox">

 
<div className="profileHeader">

  <div className="headerLeft">

    <label
      className="avatarLabel"
    >

      <img
        src={
          user?.avatar ||
          `https://ui-avatars.com/api/?name=${encodeURIComponent( user?.fullName || "User" )}`
        }
        alt=""
        className="avatarImg"
      />

      <input
        type="file"
        accept="image/*"
        hidden
        onChange={(e)=>{
          uploadAvatar(
            e.target.files?.[0]
          );
        }}
      />

      <div className="avatarOverlay">
        {
          uploadingAvatar
            ? "..."
            : "Đổi"
        }
      </div>

    </label>

    <div className="profileTitle">

      <h1>
        Tài khoản
      </h1>

      <div className="headerMail">
        {user?.email}
      </div>

    </div>

  </div>

  <button
    className="backBtn"
    onClick={() => {
      window.location.href = "/";
    }}
  >
    ← Quay lại
  </button>

</div>


				
        <div className="profileGrid">
		
		<div className="profileCard">

		  <h3>
			Lịch sử thanh toán
		  </h3>

		  {!billings.length && (
			<div className="emptyBilling">
			  Chưa có giao dịch
			</div>
		  )}

		  {billings.map((x) => (

			<div
			  key={x._id}
			  className="billingItem"
			>

			  <div className="billingTop">

				<strong>
				  {x.plan}
				</strong>

				<span
				  className={
					x.status ===
					"approved"
					  ? "billingStatus ok"
					  : x.status ===
						"pending"
					  ? "billingStatus pending"
					  : "billingStatus"
				  }
				>
				  {x.status}
				</span>

			  </div>

			  <div className="billingPrice">
				{(x.amount || 0)
				  .toLocaleString("vi-VN")}đ
			  </div>

			  <div className="billingDate">
				{new Date(
				  x.createdAt
				).toLocaleString("vi-VN")}
			  </div>

			</div>

		  ))}

		</div>

		
		
<div className="profileCard"> <h3> Usage hôm nay </h3> {usage && [ [ "Chat", usage.used?.chat || 0, usage.limits?.chatPerDay || 0 ], [ "File", usage.used?.file || 0, usage.limits?.filePerDay || 0 ], [ "Image", usage.used?.image || 0, usage.limits?.imagePerDay || 0 ] ].map(([name, used, limit]) => { const percent = limit > 0 ? Math.min( 100, Math.round( (used * 100) / limit ) ) : 0; return ( <div key={name} className="usageItem" > <div className="usageHead"> <span> {name} </span> <span> {used}/{limit} </span> </div> <div className="usageBar"> <div className={ percent >= 90 ? "usageFill red" : percent >= 70 ? "usageFill orange" : "usageFill" } style={{ width: percent + "%" }} /> </div> </div> ); })} </div>

          <div className="profileCard">

            <h3>
              Thông tin cá nhân
            </h3>

            <input
              placeholder="Họ tên"
              value={
                user.fullName || ""
              }
              onChange={(e)=>
                setUser({
                  ...user,
                  fullName:
                    e.target.value
                })
              }
            />

            <input
              placeholder="Username"
              value={
                user.username || ""
              }
              disabled
            />

            <input
              placeholder="Email"
              value={
                user.email || ""
              }
              disabled
            />

            <input
              placeholder="Số điện thoại"
              value={
                user.phone || ""
              }
              onChange={(e)=>
                setUser({
                  ...user,
                  phone:
                    e.target.value
                })
              }
            />

           
            <button
              onClick={
                saveProfile
              }
              disabled={saving}
            >
              {saving
                ? "Đang lưu..."
                : "Lưu thông tin"}
            </button>

          </div>

          <div className="profileCard">

            <h3>
              Gói tài khoản
            </h3>

            <div className="planBox">
              <strong>
                {user.plan || "free"}
              </strong>
            </div>

            <div>
              Hết hạn:
            </div>

            <div className="expireBox">
              {user.planExpireAt
                ? new Date(
                    user.planExpireAt
                  ).toLocaleDateString()
                : "Không giới hạn"}
            </div>

          </div>

          <div className="profileCard">

            <h3>
              Đổi mật khẩu
            </h3>

            <input
              type="password"
              placeholder="Mật khẩu cũ"
              value={
                passwordBox.oldPassword
              }
              onChange={(e)=>
                setPasswordBox({
                  ...passwordBox,
                  oldPassword:
                    e.target.value
                })
              }
            />

            <input
              type="password"
              placeholder="Mật khẩu mới"
              value={
                passwordBox.newPassword
              }
              onChange={(e)=>
                setPasswordBox({
                  ...passwordBox,
                  newPassword:
                    e.target.value
                })
              }
            />

            <input
              type="password"
              placeholder="Nhập lại mật khẩu"
              value={
                passwordBox.rePassword
              }
              onChange={(e)=>
                setPasswordBox({
                  ...passwordBox,
                  rePassword:
                    e.target.value
                })
              }
            />

            <button
              onClick={
                changePassword
              }
            >
              Đổi mật khẩu
            </button>

          </div>

        </div>

        {msg && (
          <div className="successBox">
            {msg}
          </div>
        )}

        {error && (
          <div className="errorBox">
            {error}
          </div>
        )}

      </div>

    </div>
  );
}
