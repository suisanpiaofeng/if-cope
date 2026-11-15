import { redirect } from "next/navigation";

/** 旧工作台入口：已由项目视图（/projects/:id）取代（P4 定稿 §3.5 工作台下线） */
export default function Home() {
  redirect("/projects");
}
