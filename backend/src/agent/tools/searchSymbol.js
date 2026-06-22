import fs from "fs/promises";
import path from "path";
import { listWorkspaceFiles, resolveWorkspacePath } from "../workspace.js";

function createChunks(filePath, content) {
  const chunks = [];
  const patterns = [
    { type: "function", regex: /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g },
    { type: "class", regex: /(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/g },
    { type: "variable", regex: /(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=/g },
    { type: "route", regex: /router\.(?:get|post|put|patch|delete)\s*\(\s*["'`]([^"'`]+)["'`]/g }
  ];

  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern.regex)) {
      const start = Math.max(0, match.index - 250);
      chunks.push({
        file: filePath,
        type: pattern.type,
        name: match[1],
        content: content.slice(start, start + 1500)
      });
    }
  }

  return chunks;
}

export async function searchSymbolTool({
  query,
  activeFiles = [],
  workspaceRoot
}) {

  const q =
    String(query || "")
      .toLowerCase()
      .trim();

  const keywords =
    q
      .split(/\s+/)
      .filter(
        x => x.length > 2
      );
	  
	  const synonyms = {

		  stream: [
			"token",
			"sse",
			"res.write"
		  ],

		  upload: [
			"multer",
			"file",
			"activefiles"
		  ],

		  chat: [
			"savechat",
			"messages"
		  ],

		  route: [
			"router",
			"post",
			"get"
		  ],

		  bug: [
			"error",
			"catch",
			"throw"
		  ]

		};
		const expandedKeywords =
		  [...keywords];

		keywords.forEach(k => {

		  if (synonyms[k]) {

			expandedKeywords.push(
			  ...synonyms[k]
			);

		  }

		});
  const results = [];
  let filesToSearch = activeFiles;

  if (workspaceRoot) {
    try {
      const paths = await listWorkspaceFiles(workspaceRoot, { limit: 1000 });
      filesToSearch = [];

      for (const filePath of paths) {
        if (![".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"].includes(path.extname(filePath))) {
          continue;
        }

        try {
          const resolved = resolveWorkspacePath(workspaceRoot, filePath);
          const content = await fs.readFile(resolved.absolutePath, "utf8");
          filesToSearch.push({
            name: filePath,
            path: filePath,
            content,
            chunks: createChunks(filePath, content)
          });
        } catch {
          // Ignore unreadable files.
        }
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  for (const file of filesToSearch) {

    const chunks =
      file.chunks?.length ? file.chunks : createChunks(file.path || file.name, String(file.content || ""));

    for (const chunk of chunks) {

      const symbol =
        String(
          chunk.name || ""
        ).toLowerCase();

      const type =
        String(
          chunk.type || ""
        ).toLowerCase();

      const content =
        String(
          chunk.content || ""
        ).toLowerCase();

      let score = 0;

      /* =====================
         EXACT SYMBOL
      ===================== */

      if (symbol === q)
        score += 1000;

      if (symbol.includes(q))
        score += 700;

      if (q.includes(symbol))
        score += 500;

      /* =====================
         KEYWORD IN SYMBOL
      ===================== */

      keywords.forEach(k => {

        if (
          symbol.includes(k)
        ) {

          score += 120;

        }

      });

      /* =====================
         KEYWORD IN CONTENT
      ===================== */

      keywords.forEach(k => {

        if (
          content.includes(k)
        ) {

          score += 20;

        }

      });

      /* =====================
         EXPORT BOOST
      ===================== */

      if (
        content.includes(
          "export "
        )
      ) {

        score += 30;

      }

      /* =====================
         ROUTE BOOST
      ===================== */

      if (

        content.includes(
          "router."
        )

        ||

        content.includes(
          "app."
        )

      ) {

        score += 50;

      }

      /* =====================
         ERROR BOOST
      ===================== */

      if (

        q.includes("error")

        ||

        q.includes("bug")

        ||

        q.includes("lỗi")

        ||

        q.includes("cannot")

      ) {

        if (

          content.includes("catch")

          ||

          content.includes("throw")

          ||

          content.includes("error")

        ) {

          score += 80;

        }

      }

      /* =====================
         STREAM BOOST
      ===================== */

      if (

        q.includes("stream")

        ||

        q.includes("token")

      ) {

        if (

          content.includes("stream")

          ||

          content.includes("token")

          ||

          content.includes("res.write")

        ) {

          score += 100;

        }

      }

      /* =====================
         UPLOAD BOOST
      ===================== */

      if (

        q.includes("upload")

        ||

        q.includes("file")

      ) {

        if (

          content.includes("multer")

          ||

          content.includes("upload")

          ||

          content.includes("activefiles")

        ) {

          score += 100;

        }

      }

      if (
        score <= 0
      ) continue;

      results.push({

        file:
          file.path || file.name,

        symbol:
          chunk.name,

        type:
          chunk.type,

        score,

        preview:
          content.slice(
            0,
            1000
          )

      });

    }

  }

  results.sort(
    (a,b) =>
      b.score - a.score
  );

  return {

    success: true,

    results:
      results.slice(0,30)

  };

}
