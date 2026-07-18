// pdfjs worker 经 Vite `?worker&inline` 内联为 Worker 构造器；本项目 tsconfig 未引入 vite/client，
// 故在此本地声明该虚拟模块形态（与 vite/client.d.ts 中 `*?worker&inline` 声明同构）。
declare module '*?worker&inline' {
  const workerConstructor: { new (): Worker };
  export default workerConstructor;
}
