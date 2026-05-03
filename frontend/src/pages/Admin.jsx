// ============================================
// frontend/src/pages/Admin.jsx
// BUILD ADMIN PANEL FULL
// ============================================

import React, {
  useEffect,
  useState
} from "react";
import { useNavigate } from "react-router-dom";

import {
  apiGet,
  apiPost
} from "../services/api";

export default function Admin() {
  const [
    list,
    setList
  ] = useState([]);

  const nav = useNavigate();

  const [
    loading,
    setLoading
  ] = useState(true);

  const [
    q,
    setQ
  ] = useState("");

  const [
    status,
    setStatus
  ] = useState("");

  const [
    denied,
    setDenied
  ] = useState(false);
  
  const [chart, setChart] =
  useState([]);

  const [
    stats,
    setStats
  ] = useState({
    pending: 0,
    approved: 0,
    revenue: 0
  });

  async function loadAnalytics() {
    try {
      const r =
        await apiGet(
          "/admin/analytics"
        );

      const d =
        await r.json();

      setStats(d);

    } catch {
      setStats(null);
    }
  }

  async function loadData() {
    setLoading(true);

    try {
      const params =
        new URLSearchParams();

      if (q) {
        params.append("q", q);
      }

      if (status) {
        params.append("status", status);
      }

      const r = await apiGet(
        "/admin/billings?" +
        params.toString()
      );

      if (
        r.status === 401 ||
        r.status === 403
      ) {
        setDenied(true);
        return;
      }

      const d = await r.json();

      setList(
        Array.isArray(d)
          ? d
          : []
      );

    } catch (err) {
      console.log(err);
      setList([]);
    }

    setLoading(false);
  }


	async function loadChart() {
	  try {
		const r =
		  await apiGet(
			"/admin/analytics/chart"
		  );

		const d =
		  await r.json();

		setChart(d);

	  } catch {
		setChart([]);
	  }
	}


  async function approve(id) {
    try {
      await apiPost(
        "/admin/upgrade/" +
        id +
        "/approve",
        {}
      );

      await loadData();
	  await loadAnalytics();
	  await loadChart();

    } catch { }
  }
	function formatDate(d) {
	  if (!d) return "-";

	  const date = new Date(d);

	  if (isNaN(date.getTime())) return "-";

	  return date.toLocaleString("vi-VN");
	}

  async function reject(id) {
    try {
      await apiPost(
        "/admin/upgrade/" +
        id +
        "/reject",
        {}
      );

      await loadData();

    } catch { }
  }

  useEffect(() => {
	  loadData();
	  loadAnalytics();
	  loadChart();
	}, []);

  if (denied) {
    return (
      <div className="adminPage">
        <div className="forbiddenBox">
          ⛔ Bạn không có quyền vào trang Admin.
        </div>
      </div>
    );
  }

  return (
    <>
     <div className="adminPage">
	 
	 
	<div className="adminStats">

          <div className="statCard">
            <span>Total Users</span>
            <strong>
              {stats?.totalUsers || 0}
            </strong>
          </div>

          <div className="statCard">
            <span>New Today</span>
            <strong>
              {stats.newUsers || 0}
            </strong>
          </div>

          <div className="statCard">
            <span>Pro Users</span>
            <strong>
              {stats.proUsers || 0}
            </strong>
          </div>

          <div className="statCard">
            <span>Business</span>
            <strong>
              {stats.businessUsers}
            </strong>
          </div>

          <div className="statCard">
            <span>Chats</span>
            <strong>
              {stats.chat}
            </strong>
          </div>

          <div className="statCard">
            <span>Files</span>
            <strong>
              {stats.file}
            </strong>
          </div>

          <div className="statCard">
            <span>Images</span>
            <strong>
              {stats.image}
            </strong>
          </div>

          <div className="statCard">
            <span>Revenue</span>
            <strong>
              {stats.revenue || 0}đ
            </strong>
          </div>

        </div> 
	 
	 

<div className="chartWrap">

  <div className="chartTitle">
    User Growth (7 ngày)
  </div>

  <div className="chartRow">
    {chart.map((x, i) => (
      <div key={i} className="barCol">

        <div
          className="bar users"
          style={{
            height:
              (x.users || 0) * 20 + "px"
          }}
        ></div>

        <span>
          {x.date}
        </span>

      </div>
    ))}
  </div>

</div>


<div className="chartWrap">

  <div className="chartTitle">
    Chat Usage
  </div>

  <div className="chartRow">
    {chart.map((x, i) => (
      <div key={i} className="barCol">

        <div
          className="bar chat"
          style={{
            height:
              (x.chat || 0) * 4 + "px"
          }}
        ></div>

        <span>
          {x.date}
        </span>

      </div>
    ))}
  </div>

</div>


<div className="chartWrap">

  <div className="chartTitle">
    Revenue
  </div>

  <div className="chartRow">
    {chart.map((x, i) => (
      <div key={i} className="barCol">

        <div
          className="bar revenue"
          style={{
            height: Math.min((x.revenue || 0) / 2000, 200) + "px"
          }}
        ></div>

        <span>
          {x.date}
        </span>

      </div>
    ))}
  </div>

</div>





        <div className="adminTop">

          <h1>
            Admin Billing
          </h1>

          <div className="adminNav">

            <button
              onClick={loadData}
            >
              Refresh
            </button>

            <button
			  onClick={() => (window.location.href = "/users")}
			>
			  Users
			</button>

          </div>

        </div>

        <div className="statsGrid">

          <div className="statCard">
            <div className="statLabel">
              Pending
            </div>

            <div className="statValue">
              {stats.pending}
            </div>
          </div>

          <div className="statCard">
            <div className="statLabel">
              Approved
            </div>

            <div className="statValue">
              {stats.approved}
            </div>
          </div>

          <div className="statCard">
            <div className="statLabel">
              Revenue
            </div>

            <div className="statValue">
              {stats.revenue?.toLocaleString()}đ
            </div>
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

          <select
            value={status}
            onChange={(e) =>
              setStatus(
                e.target.value
              )
            }
          >
            <option value="">
              All
            </option>

            <option value="pending">
              Pending
            </option>

            <option value="approved">
              Approved
            </option>
          </select>

          <button
            onClick={loadData}
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
              <div>Amount</div>
              <div>Status</div>
              <div>Time</div>
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
                    {x.plan}
                  </div>

                  <div>
                    {x.amount}
                  </div>

                  <div>
                    {x.status}
                  </div>

                  <div>
                    {formatDate(x.createdAt)}
                  </div>

                  <div className="actionCell">
                    {x.status ===
                      "pending" ? (
                      <>
                        <button
                          className="okBtn"
                          onClick={() =>
                            approve(
                              x._id
                            )
                          }
                        >
                          Approve
                        </button>

                        <button
                          className="rejectBtn"
                          onClick={() =>
                            reject(
                              x._id
                            )
                          }
                        >
                          Reject
                        </button>
                      </>
                    ) : (
                      "-"
                    )}
                  </div>

                </div>
              )
            )}

          </div>
        )}

      </div>
    </>
  );
}