export async function listFilesTool({

  activeFiles = []

}) {

  return {

    success: true,

    files:

      activeFiles.map(f => ({

        name:
          f.name,

        path:
          f.path,

        type:
          f.type

      }))

  };

}