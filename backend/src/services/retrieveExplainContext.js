export function retrieveExplainContext({
  query = "",
  flowMap = [],
  importGraph = {},
  callGraph = {}
}) {

  const q =
    String(query || "")
      .toLowerCase();

  const flows =
    flowMap
      .filter(flow => {

        const text =
          JSON.stringify(flow)
            .toLowerCase();

        return text.includes(q);

      })
      .slice(0,20);

  return {

    intent:
      "explain",

    flows,

    imports:
      importGraph,

    calls:
      callGraph

  };

}