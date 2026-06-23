import axios from "axios";

export const API_BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

const apiClient = axios.create({
  baseURL: API_BASE_URL + "/api"
});

apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers = config.headers || {};
    config.headers["Authorization"] = "Bearer " + token;
  }
  return config;
});

export { apiClient };
export default apiClient;

// Legacy fetch-based helpers (use API_BASE_URL internally)
function getHeaders() {
  const token = localStorage.getItem("token");
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = "Bearer " + token;
  return headers;
}

export function apiGet(url) {
  return fetch(API_BASE_URL + "/api" + url, { cache: "no-store", headers: getHeaders() });
}

export function apiPost(url, body) {
  return fetch(API_BASE_URL + "/api" + url, {
    cache: "no-store", method: "POST", headers: getHeaders(), body: JSON.stringify(body)
  });
}

export function apiPut(url, body = {}) {
  return fetch(API_BASE_URL + "/api" + url, {
    method: "PUT", headers: getHeaders(), body: JSON.stringify(body)
  });
}

export function apiDelete(url) {
  return fetch(API_BASE_URL + "/api" + url, {
    method: "DELETE", headers: getHeaders()
  });
}
