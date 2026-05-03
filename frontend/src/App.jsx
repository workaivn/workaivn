import React, { useEffect, useState } from "react";

import Login from "./pages/Login.jsx";
import Register from "./pages/Register.jsx";
import Chat from "./pages/Chat.jsx";
import Landing from "./pages/Landing.jsx";
import Admin from "./pages/Admin.jsx";
import Users from "./pages/Users.jsx";
import AdminDashboard from "./pages/AdminDashboard";

export default function App() {
  const host = window.location.hostname;
  const path = window.location.pathname;

  const isLanding =
    host === "workaivn.com" ||
    host === "www.workaivn.com";

  const isAdminPage = path === "/admin";
  const isUsersPage = path === "/users";
  const isAdminDashboard = path === "/admin-dashboard";

  if (isLanding) {
    return <Landing />;
  }

  const token = localStorage.getItem("token");

  const [page, setPage] = useState(
    token ? "home" : "login"
  );

  const [tab, setTab] = useState("chat");

  useEffect(() => {
    const saved = localStorage.getItem("activeTab");
    if (saved) {
      setTab(saved);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("activeTab", tab);
  }, [tab]);

  // 🔥 FIX: đảm bảo render đúng theo URL
  if (isAdminPage) {
    return <Admin />;
  }

  if (isUsersPage) {
    return <Users />;
  }

  if (isAdminDashboard) {
    return <AdminDashboard />;
  }

  if (page === "login") {
    return <Login setPage={setPage} />;
  }

  if (page === "register") {
    return <Register setPage={setPage} />;
  }

  return <Chat tab={tab} setTab={setTab} />;
}