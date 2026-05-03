import React, { useState, useEffect } from "react";
const API='https://api.workaivn.com/api';
export default function Register({setPage}){
 const [email,setEmail]=useState(''); const [password,setPassword]=useState(''); const [repassword,setRepassword]=useState(''); const [error,setError]=useState('');
 async function register() {
  try {
    console.log("CLICK REGISTER"); // 👈 debug

    if (password !== repassword) {
      return setError('Mật khẩu không khớp');
    }

    const r = await fetch(API + '/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    console.log("RESPONSE STATUS:", r.status);

    const d = await r.json();

    console.log("DATA:", d);

    if (d.ok) {
      setPage('login');
    } else {
      setError('Email đã tồn tại');
    }

  } catch (err) {
    console.error("REGISTER ERROR:", err);
    setError("Không kết nối được server");
  }
}
 return <div className='authWrap'><div className='authBox'><h1>Tạo tài khoản</h1><p>Gia nhập WorkAI VN</p><input placeholder='Email' value={email} onChange={e=>setEmail(e.target.value)}/><input type='password' placeholder='Mật khẩu' value={password} onChange={e=>setPassword(e.target.value)}/><input type='password' placeholder='Nhập lại mật khẩu' value={repassword} onChange={e=>setRepassword(e.target.value)}/>{error&&<div className='errorBox'>{error}</div>}<button onClick={register}>Tạo tài khoản</button><span onClick={()=>setPage('login')}>Đã có tài khoản? Đăng nhập</span></div></div>
}
