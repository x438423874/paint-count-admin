// pdfmake 模块声明（无官方类型）
declare module 'pdfmake/build/pdfmake' {
  const pdfMake: any;
  export default pdfMake;
}

declare module 'pdfmake/build/vfs_fonts' {
  const vfs: any;
  export const pdfMake: { vfs: any };
}
