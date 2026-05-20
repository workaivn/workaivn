export function detectIntent(
  text = ""
) {

  const q =
    text.toLowerCase();

  /* =====================
     LOCATE
  ===================== */

  const locateWords = [

    "ở đâu",
    "file nào",
    "nằm đâu",
    "nằm ở đâu",
    "where",
    "located",
    "defined",
    "định nghĩa"

  ];

  if (
    locateWords.some(
      x => q.includes(x)
    )
  ) {

    return "locate";

  }

  /* =====================
     BUG FIX
  ===================== */

  const bugWords = [

    "fix",
    "bug",
    "lỗi",
    "error",
    "crash",
    "refactor"

  ];

  if (
    bugWords.some(
      x => q.includes(x)
    )
  ) {

    return "bugfix";

  }

  /* =====================
     EXPLAIN
  ===================== */

  const explainWords = [

    "giải thích",
    "explain",
    "how",
    "luồng",
    "flow",
    "hoạt động"

  ];

  if (
    explainWords.some(
      x => q.includes(x)
    )
  ) {

    return "explain";

  }

  return "general";

}