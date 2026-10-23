/** 全应用共用的数据形状 */

/** 资源（学生上传的资料 / 网页 / 粘贴文本） */
export type Source = {
  id: number;
  title: string;
  ext: string;
  size: number;
  source_type: string;   // file | link
  url: string | null;
  type: string;          // 课件 | 真题 | 笔记 | 录音 | 网页 | 其他
  category_id: number | null;
  status: string;        // processing | ready | failed
  note: string | null;
  page_count: number;
  chunk_count: number;
  created_at: number;
};
