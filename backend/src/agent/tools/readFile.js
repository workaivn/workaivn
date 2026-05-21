export async function readFileTool({

  path,

  activeFiles = []

}) {

  const normalized =
    String(path || "")
      .toLowerCase()
      .trim();

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