// backend/modules/auth/auth.service.js

import User from "./auth.model.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import SibApiV3Sdk from "sib-api-v3-sdk";

const client =
  SibApiV3Sdk.ApiClient.instance;

client.authentications[
  "api-key"
].apiKey =
  process.env.BREVO_API_KEY;

const apiInstance =
  new SibApiV3Sdk.TransactionalEmailsApi();

const generateOtp = () => {
  return Math.floor(
    100000 + Math.random() * 900000
  ).toString();
};

export const forgotPasswordService = async (
  email
) => {

  email = String(email || "")
    .trim()
    .toLowerCase();

  const user =
    await User.findOne({ email });

  if (!user) {
    throw new Error("Email không tồn tại");
  }

  const otp = generateOtp();

  console.log("OTP:", otp);

  user.resetPasswordOtp = otp;

  user.resetPasswordOtpExpires =
    Date.now() + 10 * 60 * 1000;

  await user.save();
	  console.log(
	  "SENDING OTP EMAIL TO:",
	  email
	);
	
	console.log("SMTP CONFIG:", {
	  user: process.env.SMTP_USER,
	  hasPass: !!process.env.SMTP_PASS
	});
try {
  await apiInstance.sendTransacEmail({

	  sender: {
		email: "admin@workaivn.com",
		name: "WorkAI VN"
	  },

	  to: [
		{
		  email
		}
	  ],

	  subject:
		"WorkAI VN OTP",

	  htmlContent: `
		<h1>${otp}</h1>
	  `,
	});
  
  console.log(
	  "EMAIL SENT SUCCESS"
	);
	
	} catch (err) {

  console.log("SEND MAIL ERROR:", err);

}

  return {
    message: "Mã OTP đã được gửi tới email",

    // DEV ONLY
    otp
  };
};

// =========================================
// RESET PASSWORD
// =========================================

export const resetPasswordService = async ({
  email,
  otp,
  newPassword,
}) => {

  email = String(email || "")
    .trim()
    .toLowerCase();

  otp = String(otp || "")
    .trim();

  newPassword = String(
    newPassword || ""
  );

  if (!email) {
    throw new Error(
      "Vui lòng nhập email"
    );
  }

  if (!otp) {
    throw new Error(
      "Vui lòng nhập mã OTP"
    );
  }

  if (
    !newPassword ||
    newPassword.length < 6
  ) {
    throw new Error(
      "Mật khẩu tối thiểu 6 ký tự"
    );
  }

  const user =
    await User.findOne({ email });

  if (!user) {
    throw new Error(
      "Người dùng không tồn tại"
    );
  }

  if (
    user.resetPasswordOtp !== otp
  ) {
    throw new Error(
      "Mã OTP không đúng"
    );
  }

  if (
    !user.resetPasswordOtpExpires ||
    user.resetPasswordOtpExpires <
      Date.now()
  ) {
    throw new Error(
      "Mã OTP đã hết hạn"
    );
  }

  const hashedPassword =
    await bcrypt.hash(
      newPassword,
      10
    );

  user.password = hashedPassword;

  user.resetPasswordOtp = null;

  user.resetPasswordOtpExpires = null;

  await user.save();

  return {
    message:
      "Thay đổi mật khẩu thành công",
  };
};

/* =========================================
REGISTER
========================================= */

export async function register(data) {

  let {
    fullName,
    username,
    email,
    password
  } = data;

  fullName = String(fullName || "").trim();

  username = String(username || "")
    .trim()
    .toLowerCase();

  email = String(email || "")
    .trim()
    .toLowerCase();

  password = String(password || "");

  /* VALIDATE */

  if (!fullName) {
    throw "Vui lòng nhập họ tên";
  }

  if (!username) {
    throw "Vui lòng nhập username";
  }

  if (!email) {
    throw "Vui lòng nhập email";
  }

  if (!password || password.length < 6) {
    throw "Mật khẩu tối thiểu 6 ký tự";
  }

  /* CHECK EMAIL */

  const emailExists =
    await User.findOne({ email });

  if (emailExists) {
    throw "Email đã tồn tại";
  }

  /* CHECK USERNAME */

  const usernameExists =
    await User.findOne({ username });

  if (usernameExists) {
    throw "Username đã tồn tại";
  }

  /* HASH */

  const hash =
    await bcrypt.hash(password, 10);

  /* CREATE */

  const user =
    await User.create({
      fullName,
      username,
      email,
      password: hash,
      plan: "free"
    });

  return user;
}

/* =========================================
LOGIN
========================================= */

export async function login(account, password) {

  account = String(account || "")
    .trim()
    .toLowerCase();

  password = String(password || "");

  const user =
    await User.findOne({
      $or: [
        { email: account },
        { username: account }
      ]
    });

  if (!user) {
    throw "Tài khoản không tồn tại";
  }

  if (user.status === "blocked") {
    throw "Tài khoản đã bị khóa";
  }

  const ok =
    await bcrypt.compare(
      password,
      user.password
    );

  if (!ok) {
    throw "Sai mật khẩu";
  }

  user.lastLoginAt = new Date();

  await user.save();

  const token =
    jwt.sign(
      {
        id: user._id,
        role: user.role
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "30d"
      }
    );

  return {
    token,

    user: {
      id: user._id,
      fullName: user.fullName,
      username: user.username,
      email: user.email,
      role: user.role,
      plan: user.plan
    }
  };
}

/* =========================================
GET PROFILE
========================================= */

export async function getProfile(userId) {

  const user =
    await User.findById(userId)
    .select("-password");

  if (!user) {
    throw "Người dùng không tồn tại";
  }

  return user;
}

/* =========================================
UPDATE PROFILE
========================================= */

export async function updateProfile(
  userId,
  data
) {

  const user =
    await User.findById(userId);

  if (!user) {
    throw "Tài khoản không tồn tại";
  }

  const fullName =
    String(data.fullName || "").trim();

  const phone =
    String(data.phone || "").trim();

  const avatar =
    String(data.avatar || "").trim();

  if (fullName) {
    user.fullName = fullName;
  }

  user.phone = phone;
  user.avatar = avatar;

  await user.save();

  return user;
}

/* =========================================
CHANGE PASSWORD
========================================= */

export async function changePassword(
  userId,
  oldPassword,
  newPassword
) {

  const user =
    await User.findById(userId);

  if (!user) {
    throw "Tài khoản không tồn tại";
  }

  const ok =
    await bcrypt.compare(
      oldPassword,
      user.password
    );

  if (!ok) {
    throw "Mật khẩu cũ không đúng";
  }

  if (
    !newPassword ||
    newPassword.length < 6
  ) {
    throw "Mật khẩu mới tối thiểu 6 ký tự";
  }

  user.password =
    await bcrypt.hash(
      newPassword,
      10
    );

  await user.save();

  return true;
}