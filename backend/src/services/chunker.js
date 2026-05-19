import { parse } from "@babel/parser";

/* =====================================
   CODE CHUNKER
===================================== */

function chunkJavaScript(
  text,
  fileName = ""
) {

  try {

    const ast =
      parse(text, {
        sourceType: "unambiguous",
        plugins: [
          "jsx",
          "typescript"
        ]
      });

    const chunks = [];

    ast.program.body.forEach(
      (node) => {

        const start =
          node.start || 0;

        const end =
          node.end || 0;

        const content =
          text.slice(start, end);

        let name =
          "anonymous";

        let type =
          node.type;

        /* function */

      	if (
		  node.type ===
			"FunctionDeclaration" &&
		  node.id?.name
		) {

		  name =
			node.id.name;

		  type =
			"FunctionDeclaration";

		}

/* export function */

		else if (
		  node.type ===
			"ExportNamedDeclaration" &&
		  node.declaration?.type ===
			"FunctionDeclaration"
		) {

		  const fn =
			node.declaration;

		  if (
			fn.id?.name
		  ) {

			name =
			  fn.id.name;

			type =
			  "FunctionDeclaration";

		  }

		}


        /* variable */

        else if (
          node.type ===
            "VariableDeclaration"
        ) {

          const d =
            node.declarations?.[0];

          if (
            d?.id?.name
          ) {

            name =
              d.id.name;

          }

        }

        /* class */

        else if (
          node.type ===
            "ClassDeclaration" &&
          node.id?.name
        ) {

          name =
            node.id.name;

        }

        if (
		  content?.trim()
		) {

		  /* skip imports */

		  if (
			node.type ===
			"ImportDeclaration"
		  ) {
			return;
		  }

		  chunks.push({
			  file:
              fileName,

            type,

            name,

            content

          });
		  
		  console.log(
			  "CHUNK:",
			  {
				name,
				type
			  }
			);

        }

      }
    );

    return chunks;

  } catch (err) {

    console.log(
      "AST CHUNK FAIL:",
      err.message
    );

    return fallbackChunk(
      text,
      fileName
    );

  }

}

/* =====================================
   FALLBACK
===================================== */

function fallbackChunk(
  text,
  fileName = "",
  size = 1200
) {

  const chunks = [];

  for (
    let i = 0;
    i < text.length;
    i += size
  ) {

    chunks.push({

      file:
        fileName,

      type:
        "text",

      name:
        `chunk_${i}`,

      content:
        text.slice(
          i,
          i + size
        )

    });

  }

  return chunks;

}

/* =====================================
   MAIN
===================================== */

export function chunkText(
  text,
  fileName = ""
) {

  if (!text) {
    return [];
  }

  const lower =
    fileName
      .toLowerCase();

  /* JS TS JSX TSX */

  if (
    [
      ".js",
      ".jsx",
      ".ts",
      ".tsx",
      ".mjs",
      ".cjs"
    ].some(ext =>
      lower.endsWith(ext)
    )
  ) {

    return chunkJavaScript(
      text,
      fileName
    );

  }

  return fallbackChunk(
    text,
    fileName
  );

}

/* =====================================
   SUMMARY
===================================== */

export function summarizeFile(
  name,
  text
) {

  const lines =
    text
      .split("\n")
      .slice(0, 60)
      .join("\n");

  return `

FILE: ${name}

Preview:
${lines}

`;

}