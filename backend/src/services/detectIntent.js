export function detectIntent(
  text = ""
) {

  const q =
    String(text || "")
      .toLowerCase()
      .trim();

  const score = {

    locate: 0,
    explain: 0,
    bugfix: 0,
    feature: 0

  };

  /* =====================
     LOCATE
  ===================== */

  [
    "ở đâu",
    "file nào",
    "nằm đâu",
    "nằm ở đâu",
    "defined",
    "where",
    "function nào",
    "hàm nào",
    "class nào"
  ].forEach(word => {

    if (q.includes(word)) {
      score.locate += 10;
    }

  });

  /* =====================
     EXPLAIN
  ===================== */

  [
    "giải thích",
    "explain",
    "flow",
    "luồng",
    "kiến trúc",
    "architecture",
    "cách hoạt động",
    "hoạt động thế nào",
    "chạy thế nào"
  ].forEach(word => {

    if (q.includes(word)) {
      score.explain += 10;
    }

  });

  /* =====================
     BUG FIX
  ===================== */

  [
    "bug",
    "fix",
    "error",
    "lỗi",
    "undefined",
    "null",
    "cannot",
    "unexpected",
    "crash",
    "không chạy",
    "không hoạt động",
    "không render",
    "không stream",
    "không upload",
    "render trùng",
    "token trùng",
    "stream trùng",
    "duplicate",
    "duplicated",
    "bị lỗi",
    "bị trùng"
  ].forEach(word => {

    if (q.includes(word)) {
      score.bugfix += 20;
    }

  });

  /* =====================
     FEATURE
  ===================== */

  [
    "thêm",
    "tạo",
    "create",
    "implement",
    "new feature",
    "làm chức năng",
    "xây dựng",
    "bổ sung"
  ].forEach(word => {

    if (q.includes(word)) {
      score.feature += 10;
    }

  });

  const best =
    Object.entries(score)
      .sort(
        (a,b) =>
          b[1] - a[1]
      )[0];

  if (
    !best ||
    best[1] <= 0
  ) {

    return "general";

  }

  return best[0];

}