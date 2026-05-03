// ============================================
// frontend/src/pages/Users.jsx
// BUILD USER MANAGER FULL
// ============================================
import { formatLimit } from "../utils/format";
import React, {
  useEffect,
  useState
} from "react";

import {
  apiGet,
  apiPost
} from "../services/api";

export default function Users() {
  const [
    list,
    setList
  ] = useState([]);

  const [
    loading,
    setLoading
  ] = useState(true);

  const [
    q,
    setQ
  ] = useState("");
  const [
	  inspect,
	  setInspect
	] = useState(null);

	const [
	  inspectOpen,
	  setInspectOpen
	] = useState(false);


	async function openUsage(id) {
	  try {
		const r =
		  await apiGet(
			"/admin/user/" +
			  id +
			  "/usage"
		  );

		const d =
		  await r.json();

		setInspect(d);
		setInspectOpen(true);

	  } catch {}
	}


  async function loadUsers() {
    try {
      setLoading(true);

      const r =
        await apiGet(
          "/admin/users?q=" +
            encodeURIComponent(
              q
            )
        );

      const d =
        await r.json();

      setList(
        Array.isArray(d)
          ? d
          : []
      );

    } catch {
      setList([]);
    } finally {
      setLoading(false);
    }
  }

  async function setPlan(
    id,
    plan
  ) {
    try {
      await apiPost(
        "/admin/user/" +
          id +
          "/plan",
        { plan }
      );

      await loadUsers();

    } catch {}
  }

  useEffect(() => {
    loadUsers();
  }, []);

  return (
    <div className="adminPage">

      <div className="adminTop">

	  <h1>
		User Manager
	  </h1>

	  <div className="adminNav">

		<button
		  onClick={loadUsers}
		>
		  Refresh
		</button>

		<button
		  onClick={() =>
			window.location.href =
			  "/admin"
		  }
		>
		  Billing
		</button>

	  </div>

	</div>

      <div className="adminFilters">

        <input
          value={q}
          onChange={(e) =>
            setQ(
              e.target.value
            )
          }
          placeholder="Tìm email..."
        />

        <button
          onClick={loadUsers}
        >
          Search
        </button>

      </div>

      {loading ? (
        <div>
          Loading...
        </div>
      ) : (
        <div className="adminTable">

          <div className="thead">
            <div>Email</div>
            <div>Plan</div>
            <div>Created</div>
            <div>Expire</div>
            <div>Action</div>
          </div>

          {list.map(
            (x) => (
              <div
                className="trow"
                key={x._id}
              >
                <div>
                  {x.email}
                </div>

                <div>
                  {x.plan ||
                    "free"}
                </div>

                <div>
                  {new Date(
                    x.createdAt
                  ).toLocaleDateString()}
                </div>

                <div>
                  {x.planExpireAt
                    ? new Date(
                        x.planExpireAt
                      ).toLocaleDateString()
                    : "-"}
                </div>

                <div className="actionCell">
					<button
					  className="okBtn"
					  onClick={() =>
						openUsage(
						  x._id
						)
					  }
					>
					  View
					</button>

                  <button
                    className="okBtn"
                    onClick={() =>
                      setPlan(
                        x._id,
                        "free"
                      )
                    }
                  >
                    Free
                  </button>

                  <button
                    className="okBtn"
                    onClick={() =>
                      setPlan(
                        x._id,
                        "pro"
                      )
                    }
                  >
                    Pro
                  </button>

                  <button
                    className="okBtn"
                    onClick={() =>
                      setPlan(
                        x._id,
                        "business"
                      )
                    }
                  >
                    Biz
                  </button>

                </div>

              </div>
            )
          )}

        </div>
      )}
	  
	 {inspectOpen && inspect && (
  <div className="modalOverlay" onClick={() => setInspectOpen(false)}>
    
    <div
      className="modalBox"
      onClick={(e) => e.stopPropagation()}
    >

      <h3 style={{ marginBottom: 10 }}>
        Usage Detail
      </h3>

      {[
        ["Chat: ", inspect?.used?.chat || 0, inspect?.limits?.chat || 0],
        ["File: ", inspect?.used?.file || 0, inspect?.limits?.file || 0],
        ["Image: ", inspect?.used?.image || 0, inspect?.limits?.image || 0],
        ["Tool: ", inspect?.used?.tool || 0, inspect?.limits?.tool || 0]
      ].map(([name, used, limit]) => {
        const pct =
          limit > 0
            ? Math.min(100, Math.round((used * 100) / limit))
            : 0;

        return (
          <div key={name} style={{ marginBottom: 12 }}>
            <div className="usageHead">
              <span>{name}</span>
              <span>{used}/{formatLimit(limit)}</span>
            </div>

            <div className="usageBar">
              <div
                className={
                  pct >= 90
                    ? "usageFill red"
                    : pct >= 70
                    ? "usageFill orange"
                    : "usageFill"
                }
                style={{ width: pct + "%" }}
              />
            </div>
          </div>
        );
      })}

      <button
        style={{ marginTop: 15 }}
        onClick={() => setInspectOpen(false)}
      >
        Đóng
      </button>

    </div>
  </div>
)}

    </div>
  );
}