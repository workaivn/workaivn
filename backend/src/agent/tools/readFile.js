export async function readFileTool({

  path,

  activeFiles = []

}) {

  const normalized =
    String(path || "")
      .toLowerCase()
      .trim();

  const found =
    activeFiles.find(f => {

      const name =
        String(
          f.name || ""
        ).toLowerCase();

      return (

        name === normalized ||

        name.endsWith(
          normalized
        )

      );

    });

  if (!found) {

    return {

      success: false,

      error:
        `Cannot find uploaded file: ${path}`

    };

  }

  const content =

    found.chunks
      ?.map(c => c.content)
      ?.join("\n\n")

    ||

    found.content

    ||

    "";

  return {

    success: true,

    file:
      found.name,

    content

  };

}