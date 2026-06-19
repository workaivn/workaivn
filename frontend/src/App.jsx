import React, { useEffect, useState } from "react";

import Login from "./pages/Login.jsx";
import Register from "./pages/Register.jsx";
import Chat from "./pages/Chat.jsx";
import Landing from "./pages/Landing.jsx";
import Admin from "./pages/Admin.jsx";
import Users from "./pages/Users.jsx";
import AdminDashboard from "./pages/AdminDashboard";
import Profile from "./pages/Profile";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";

export default function App() {
  const host = window.location.hostname;
  const [pathname, setPathname] = useState(() => window.location.pathname);

  const isLanding =
    host === "workaivn.com" ||
    host === "www.workaivn.com";

  useEffect(() => {
    function handlePopState() {
      setPathname(window.location.pathname);
    }

    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  const navigateTo = (nextPath) => {
    if (!nextPath || nextPath === pathname) {
      return;
    }

    window.history.pushState({}, "", nextPath);
    setPathname(window.location.pathname);
  };

  const isAdminPage = pathname === "/admin";
  const isUsersPage = pathname === "/users";
  const isAdminDashboard = pathname === "/admin-dashboard";
  const isProfilePage = pathname === "/profile";
  const isForgotPasswordPage = pathname === "/forgot-password";

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

  const shellViewByPath = {
    "/workspace": "workspace",
    "/agent-workspace": "workspace",
    "/agent-hub": "agent-hub",
    "/prompt-builder": "prompt-builder",
    "/project-memory": "project-memory",
    "/file-context": "file-context",
    "/task-workflow": "task-workflow",
    "/codex-cline-mode": "codex-cline-mode",
    "/output-evaluator": "output-evaluator"
  };

  const activeShellView = shellViewByPath[pathname] || null;

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
  
  if (isProfilePage) { return <Profile />; }
  if (isForgotPasswordPage) {
	  return <ForgotPasswordPage />;
	}
  if (page === "login") {
    return <Login setPage={setPage} />;
  }

  if (page === "register") {
    return <Register setPage={setPage} />;
  }

  return (
    <Chat
      tab={tab}
      setTab={setTab}
      mainView={activeShellView}
      navigateTo={navigateTo}
    />
  );
}
