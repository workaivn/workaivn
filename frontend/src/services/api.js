const API =
  import.meta.env
    .VITE_API_URL ||
  "https://api.workaivn.com/api";

const getToken = () => {
  const t = localStorage.getItem("token");
  return t ? "Bearer " + t : "";
};

export function apiGet(url) {
  const token = localStorage.getItem("token");

  return fetch(API + url, {
    headers: {
      "Authorization": "Bearer " + token
    }
console.log("TOKEN IN apiGet:", token);   // 👈 THÊM
  const headers = {
    "Content-Type": "application/json"
  };

  if (token) {
    headers["Authorization"] = "Bearer " + token;
  }

  return fetch(API + url, {
    headers
  });
}

export function apiPost(url, body) {
  const token = localStorage.getItem("token");

  return fetch(API + url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + token   // 👈 FIX CHÍNH
    },
    body: JSON.stringify(body)
  });
}

export async function apiPut(url, body = {}) {
  const token = localStorage.getItem("token");

  return fetch(API + url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + token   // 👈 FIX
    },
    body: JSON.stringify(body)
  });
}

export async function apiDelete(url) {
  const token = localStorage.getItem("token");

  return fetch(API + url, {
    method: "DELETE",
    headers: {
      "Authorization": "Bearer " + token   // 👈 FIX
    }
  });
}
