export async function applyPatchTool({

  file,

  find,

  replace,

  activeFiles = []

}) {

  const normalized =
    String(file || "")
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
        `Cannot find uploaded file: ${file}`

    };

  }

  const original =

    found.content ||

    "";

  const updated =
    original.replace(
      find,
      replace
    );

  found.content =
    updated;

  return {

    success: true,

    file:
      found.name,

    updated

  };

}