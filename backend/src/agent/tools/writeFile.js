export async function writeFileTool({

  path,

  content,

  activeFiles = []

}) {

  const normalized =
    String(path || "")
      .replace(/\\/g,"/")
      .toLowerCase()
      .trim();

  const found =
    activeFiles.find(f => {

      const filePath =
        String(

          f.path ||
          f.name ||
          ""

        )
        .replace(/\\/g,"/")
        .toLowerCase();

      return (

        filePath === normalized ||

        filePath.endsWith(
          "/" + normalized
        ) ||

        filePath.endsWith(
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

  found.content =
    String(content || "");

  return {

    success: true,

    file:
      found.name,

    content:
      found.content

  };

}