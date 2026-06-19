import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { BrowserRouter } from "react-router-dom";
import "highlight.js/styles/stackoverflow-light.css";
import "./services/api"; // register axios interceptor (auth token)

import "./styles/global.css";
import "./styles/auth.css";
import "./styles/chat.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>
);