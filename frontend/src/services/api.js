const API =
  import.meta.env.VITE_API_URL ||
  "https://api.workaivn.com/api";

function getHeaders() {

  const token =
    localStorage.getItem("token");

  const headers = {
    "Content-Type":
      "application/json"
  };

  if (token) {
    headers["Authorization"] =
      "Bearer " + token;
  }

  return headers;
}

export function apiGet(url) {

  return fetch(
    API + url,
    {
      cache: "no-store",

      headers:
        getHeaders()
    }
  );

}

export function apiPost(
  url,
  body
) {

  return fetch(
    API + url,
    {
	  cache: "no-store",
      method: "POST",
      headers:
        getHeaders(),
      body: JSON.stringify(body)
    }
  );

}

export function apiPut(
  url,
  body = {}
) {

  return fetch(
    API + url,
    {
      method: "PUT",
      headers:
        getHeaders(),
      body: JSON.stringify(body)
    }
  );

}

export function apiDelete(url) {

  return fetch(
    API + url,
    {
      method: "DELETE",
      headers:
        getHeaders()
    }
  );

}