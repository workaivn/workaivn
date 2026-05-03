const API =
  import.meta.env
    .VITE_API_URL ||
  "https://api.workaivn.com/api";

const getToken = () => {
  const t = localStorage.getItem("token");
  return t ? "Bearer " + t : "";
};

export async function apiGet(
  url
) {
  const res =
    await fetch(
      API + url,
      {
        headers: {
          authorization:
            getToken()
        }
      }
    );

  return res;
}

export async function apiPost(
  url,
  body = {}
) {
  const res =
    await fetch(
      API + url,
      {
        method: "POST",
        headers: {
          "Content-Type":
            "application/json",
          authorization:
            getToken()
        },
        body: JSON.stringify(
          body
        )
      }
    );

  return res;
}

export async function apiPut(
  url,
  body = {}
) {
  const res =
    await fetch(
      API + url,
      {
        method: "PUT",
        headers: {
          "Content-Type":
            "application/json",
          authorization:
            getToken()
        },
        body: JSON.stringify(
          body
        )
      }
    );

  return res;
}

export async function apiDelete(
  url
) {
  const res =
    await fetch(
      API + url,
      {
        method:
          "DELETE",
        headers: {
          authorization:
            getToken()
        }
      }
    );

  return res;
}