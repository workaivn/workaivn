import { exec }
  from "child_process";

export async function searchCodeTool({

  query,

  activeFiles = []

}) {

  const q =
    String(query || "")
      .toLowerCase();

  const results = [];

  for (const f of activeFiles) {

    const text =
      String(
        f.content || ""
      );

    if (
      text.toLowerCase().includes(q)
    ) {

      results.push({

        file:
          f.name,

        preview:
          text
            .slice(0, 500)

      });

    }

  }

  return {

    success: true,

    results

  };

}