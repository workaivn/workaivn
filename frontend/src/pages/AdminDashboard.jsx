import { useEffect, useState } from "react";

export default function AdminDashboard() {
  const [data, setData] = useState(null);

  useEffect(() => {
    fetch("/api/admin/analytics", {
      headers: {
        authorization: localStorage.getItem("token")
      }
    })
      .then(r => r.json())
      .then(setData);
  }, []);

  if (!data) return <div>Loading...</div>;

  return (
    <div style={{ padding: 20 }}>
      <h2>Admin Dashboard</h2>

      <div>Total users: {data.totalUsers}</div>
      <div>Pro users: {data.proUsers}</div>
      <div>Revenue: {data.revenue}đ</div>
    </div>
  );
}