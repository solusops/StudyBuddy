// plotly.js-dist-min ships a prebuilt JS bundle with no bundled type declarations.
// We use it loosely (newPlot / purge), so an `any` module declaration is sufficient.
declare module "plotly.js-dist-min" {
  const Plotly: {
    newPlot: (
      el: HTMLElement,
      data: unknown[],
      layout?: Record<string, unknown>,
      config?: Record<string, unknown>,
    ) => Promise<void>
    purge: (el: HTMLElement) => void
  }
  export default Plotly
}
